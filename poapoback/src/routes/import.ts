import { Router, Response } from "express";
import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { verifyToken, AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { catalogAxes, resolveAccountTenantId, resolveCatalog, toCatalogRef } from "../services/catalogs";
import { triggerEmbeddings } from "../services/embeddings";
import { suggestMapping, validateMapping, ATTRIBUTE_KEY_PATTERN, type FieldMapping, type ImportIssue } from "../services/importMapping";
import { asyncRoute } from "../services/quizzes";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const isCSV =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "text/plain" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (isCSV) {
      cb(null, true);
    } else {
      cb(new Error("Seuls les fichiers CSV sont acceptés") as unknown as null, false);
    }
  },
});

export type { FieldMapping };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseCSVBuffer(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    const stream = Readable.from([buffer]);

    stream
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => {
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        resolve({ headers, rows });
      })
      .on("error", reject);
  });
}

const ARRAY_FIELDS = new Set(["tags"]);
const NUMBER_FIELDS = new Set(["price"]);
const BOOL_FIELDS = new Set(["active", "featured"]);

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Convertit une ligne CSV selon le mapping. Les colonnes mappées sur
 * `attribute.<clé>` alimentent `attributes` ; les clés correspondant à un axe
 * de recommandation doivent valoir un nombre entre 0 et 1.
 */
export function applyMapping(
  row: Record<string, string>,
  mapping: FieldMapping[],
  axisKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  let hasAttributes = false;
  for (const { sourceColumn, targetField } of mapping) {
    if (!targetField) continue;
    const raw = (row[sourceColumn] ?? "").trim();
    if (!raw) continue;

    if (ARRAY_FIELDS.has(targetField)) {
      result[targetField] = raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (NUMBER_FIELDS.has(targetField)) {
      const n = parseNumber(raw);
      if (n === null || n < 0) throw new Error(`Valeur numérique invalide pour « ${sourceColumn} » : « ${raw.slice(0, 40)} »`);
      result[targetField] = n;
    } else if (BOOL_FIELDS.has(targetField)) {
      const flag = raw.toLowerCase();
      if (["true", "1", "oui", "yes"].includes(flag)) result[targetField] = true;
      else if (["false", "0", "non", "no"].includes(flag)) result[targetField] = false;
      else throw new Error(`Valeur oui/non invalide pour « ${sourceColumn} » : « ${raw.slice(0, 40)} »`);
    } else if (targetField === "attributes") {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`JSON invalide dans « ${sourceColumn} »`); }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Le champ attributes doit contenir un objet JSON");
      }
      Object.assign(attributes, parsed);
      hasAttributes = true;
    } else if (targetField.startsWith("attribute.")) {
      const key = targetField.slice("attribute.".length);
      if (!ATTRIBUTE_KEY_PATTERN.test(key)) throw new Error(`Nom d’attribut invalide : '${key}'`);
      const value = parseNumber(raw);
      attributes[key] = value ?? raw;
      hasAttributes = true;
    } else {
      result[targetField] = raw;
    }
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (axisKeys.has(key) && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`L’axe '${key}' doit être un nombre entre 0 et 1 (valeur reçue : « ${String(value).slice(0, 40)} »)`);
    }
  }
  if (hasAttributes) result.attributes = attributes;
  return result;
}

// ─── POST /api/catalog/import/parse ──────────────────────────────────────────
// Champ multipart facultatif `catalogId` : catalogue cible (par défaut, le catalogue principal).
router.post("/parse", verifyToken, upload.single("file"), asyncRoute(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier CSV requis" });
    return;
  }

  const tenantId = await resolveAccountTenantId(req);
  const catalog = tenantId ? await resolveCatalog(tenantId, req.body?.catalogId) : null;
  const axes = tenantId && catalog ? await catalogAxes(tenantId, catalog.id) : [];

  try {
    const { headers, rows } = await parseCSVBuffer(req.file.buffer);
    if (headers.length === 0) {
      res.status(400).json({ error: "Fichier CSV vide ou invalide" });
      return;
    }

    // Suggestion locale et déterministe (aucun appel IA) : seules les correspondances évidentes sont proposées.
    const suggestedMapping = suggestMapping(headers, axes);

    res.json({ headers, rows, suggestedMapping, total: rows.length, catalog: catalog && toCatalogRef(catalog) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur de parsing";
    res.status(400).json({ error: message });
  }
}));

// ─── Évaluation commune (prévisualisation et import) ─────────────────────────
const MAX_ROWS = 5000;
const MAX_REPORTED_ISSUES = 100;

type RowEvaluation = { line: number; data: Record<string, unknown> | null; issues: ImportIssue[] };

/** Ligne 1 = en-têtes : la première ligne de données porte le numéro 2. */
function evaluateRows(rows: Record<string, string>[], mapping: FieldMapping[], axisKeys: ReadonlySet<string>): RowEvaluation[] {
  const axisColumns = mapping.filter((m) => m.targetField?.startsWith("attribute.") && axisKeys.has(m.targetField.slice("attribute.".length)));
  return rows.map((row, index) => {
    const line = index + 2;
    const issues: ImportIssue[] = [];
    try {
      const data = applyMapping(row, mapping, axisKeys);
      if (typeof data.name !== "string" || !data.name.trim()) {
        issues.push({ severity: "error", message: "Nom du produit manquant" });
        return { line, data: null, issues };
      }
      for (const { sourceColumn, targetField } of axisColumns) {
        if (!(row[sourceColumn] ?? "").trim()) {
          issues.push({ severity: "warning", message: `Axe « ${targetField!.slice("attribute.".length)} » vide : le produit sera moins précis dans les recommandations` });
        }
      }
      return { line, data, issues };
    } catch (err) {
      issues.push({ severity: "error", message: err instanceof Error ? err.message : String(err) });
      return { line, data: null, issues };
    }
  });
}

/** Valide la requête (tenant, catalogue, mapping, volume) ; renvoie null après avoir répondu en cas d'échec. */
async function prepareImport(req: AuthRequest, res: Response) {
  const { mapping, rows, catalogId } = req.body as { mapping?: unknown; rows?: unknown; catalogId?: unknown };
  if (!Array.isArray(mapping) || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "mapping et rows requis" });
    return null;
  }
  if (rows.length > MAX_ROWS) {
    res.status(400).json({ error: `Fichier trop volumineux : ${MAX_ROWS} lignes maximum par import` });
    return null;
  }
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    res.status(400).json({ error: "Lignes invalides" });
    return null;
  }
  // Le token peut contenir un tenantId logique/invalide (ex: super-admin)
  // ou un ancien tenant supprime. On securise en validant l'existence du tenant.
  const tenantId = await resolveAccountTenantId(req);
  if (!tenantId) {
    res.status(400).json({
      error: "Aucun tenant valide associe a ce compte. Creez/associez un tenant dans l'onglet Tenants puis reconnectez-vous.",
    });
    return null;
  }
  const catalog = await resolveCatalog(tenantId, catalogId);
  const axisKeys = new Set((await catalogAxes(tenantId, catalog.id)).map((axis) => axis.key));
  const checked = validateMapping(mapping, axisKeys);
  const evaluations = evaluateRows(rows as Record<string, string>[], checked.mapping, axisKeys);
  return { tenantId, catalog, mapping: checked.mapping, mappingIssues: checked.issues, evaluations };
}

// ─── POST /api/catalog/import/preview ────────────────────────────────────────
// Lecture seule : ni produit créé, ni embedding. Corps : { mapping, rows, catalogId? }.
router.post("/preview", verifyToken, asyncRoute(async (req: AuthRequest, res: Response) => {
  const prepared = await prepareImport(req, res);
  if (!prepared) return;
  const { catalog, mappingIssues, evaluations } = prepared;
  const mappingBlocked = mappingIssues.some((i) => i.severity === "error");
  const valid = mappingBlocked ? 0 : evaluations.filter((e) => e.data).length;
  const rowIssues = evaluations.flatMap((e) => e.issues.map((issue) => ({ line: e.line, ...issue })));
  const sorted = [...rowIssues.filter((i) => i.severity === "error"), ...rowIssues.filter((i) => i.severity === "warning")];
  res.json({
    catalog: toCatalogRef(catalog),
    total: evaluations.length,
    valid,
    invalid: evaluations.length - valid,
    warningRows: new Set(rowIssues.filter((i) => i.severity === "warning").map((i) => i.line)).size,
    mappingIssues,
    canImport: !mappingBlocked && valid > 0,
    issues: sorted.slice(0, MAX_REPORTED_ISSUES),
    issuesTruncated: sorted.length > MAX_REPORTED_ISSUES,
    sample: mappingBlocked ? [] : evaluations.filter((e) => e.data).slice(0, 5).map((e) => ({ line: e.line, product: e.data })),
  });
}));

// ─── POST /api/catalog/import/execute ────────────────────────────────────────
// Corps : { mapping, rows, catalogId? } — catalogId absent : catalogue par défaut du tenant.
router.post("/execute", verifyToken, asyncRoute(async (req: AuthRequest, res: Response) => {
  const prepared = await prepareImport(req, res);
  if (!prepared) return;
  const { tenantId, catalog, mappingIssues, evaluations } = prepared;
  const blocking = mappingIssues.filter((i) => i.severity === "error");
  if (blocking.length > 0) {
    res.status(400).json({ error: blocking.map((i) => i.message).join(" "), issues: blocking });
    return;
  }
  let created = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  const errors: string[] = [];

  for (const { line, data, issues } of evaluations) {
    if (!data) {
      skipped++;
      if (errors.length < 5) errors.push(`Ligne ${line} : ${issues[0]?.message ?? "invalide"}`);
      continue;
    }
    try {
      const product = await prisma.product.create({
        data: {
          tenantId,
          catalogId: catalog.id,
          name: (data.name as string).trim(),
          brand: typeof data.brand === "string" ? data.brand : null,
          description: typeof data.description === "string" ? data.description : null,
          price: typeof data.price === "number" ? data.price : null,
          imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : null,
          purchaseUrl: typeof data.purchaseUrl === "string" ? data.purchaseUrl : null,
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          attributes:
            typeof data.attributes === "object" && data.attributes !== null && !Array.isArray(data.attributes)
              ? (data.attributes as object)
              : {},
          active: typeof data.active === "boolean" ? data.active : true,
          featured: typeof data.featured === "boolean" ? data.featured : false,
        },
      });
      createdIds.push(product.id);
      created++;
    } catch (err) {
      skipped++;
      if (errors.length < 5) errors.push(`Ligne ${line} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Embeddings locaux (poapoai, sans OpenAI) en arrière-plan : ils pèsent 60 % du score de recommandation.
  // Aucun état de préparation n'est exposé par l'API : on indique seulement si la demande a été lancée.
  const embeddings = createdIds.length === 0 ? "none" : process.env.AI_SERVICE_URL ? "queued" : "unavailable";
  if (embeddings === "queued") triggerEmbeddings(createdIds, tenantId).catch(console.error);
  res.json({ created, skipped, errors, embeddings, catalog: toCatalogRef(catalog) });
}));

export default router;
