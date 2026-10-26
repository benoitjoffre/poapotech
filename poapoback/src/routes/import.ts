import { Router, Response } from "express";
import multer from "multer";
import csvParser from "csv-parser";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "stream";
import { Prisma } from "@prisma/client";
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
const STALE_IMPORT_MS = 10 * 60 * 1000;

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
  const fingerprint = createHash("sha256")
    .update(`${catalog.id}\n${JSON.stringify(req.body.mapping)}\n${JSON.stringify(req.body.rows)}`)
    .digest("hex");
  const clientKey = String(req.get("Idempotency-Key") ?? req.body?.importKey ?? "").trim().slice(0, 200);
  const allowDuplicate = req.body?.allowDuplicate === true;
  const key = clientKey || `fp:${fingerprint}${allowDuplicate ? `:${randomUUID()}` : ""}`;
  const scope = { tenantId, catalogId: catalog.id };
  const inProgress = { error: "Cet import est déjà en cours.", code: "import_in_progress" };

  // Idempotence : un rejeu (double clic, coupure réseau) renvoie le résultat déjà obtenu sans recréer de produit.
  const existing = await prisma.importBatch.findUnique({ where: { tenantId_catalogId_key: { ...scope, key } } });
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      res.status(422).json({ error: "Cette clé d'import a déjà servi pour un fichier différent.", code: "idempotency_key_reused" });
      return;
    }
    if (existing.status === "completed") {
      res.json({ ...(existing.result as object), replayed: true });
      return;
    }
    if (existing.status === "processing" && Date.now() - existing.updatedAt.getTime() < STALE_IMPORT_MS) {
      res.status(409).json(inProgress);
      return;
    }
    // Import interrompu ou en échec : l'insertion est atomique, aucun produit à nettoyer — on le reprend.
    const claimed = await prisma.importBatch.updateMany({
      where: { id: existing.id, updatedAt: existing.updatedAt },
      data: { status: "processing" },
    });
    if (claimed.count === 0) {
      res.status(409).json(inProgress);
      return;
    }
  } else {
    if (!allowDuplicate) {
      const duplicate = await prisma.importBatch.findFirst({
        where: { ...scope, fingerprint, status: "completed" },
        orderBy: { createdAt: "desc" },
      });
      if (duplicate) {
        res.status(409).json({
          error: "Ce fichier a déjà été importé dans ce catalogue. Relancez avec allowDuplicate pour importer à nouveau.",
          code: "duplicate_import",
          previous: duplicate.result,
          importedAt: duplicate.createdAt,
        });
        return;
      }
    }
    try {
      await prisma.importBatch.create({ data: { ...scope, key, fingerprint } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json(inProgress);
        return;
      }
      throw err;
    }
  }
  const batchKey = { tenantId_catalogId_key: { ...scope, key } };

  const valid = evaluations.filter((e) => e.data);
  const errors = evaluations
    .filter((e) => !e.data)
    .slice(0, 5)
    .map((e) => `Ligne ${e.line} : ${e.issues[0]?.message ?? "invalide"}`);
  let createdIds: string[];
  try {
    // Tout ou rien : une interruption ne laisse jamais d'import partiel.
    const products = await prisma.product.createManyAndReturn({
      select: { id: true },
      data: valid.map(({ data }) => {
        const d = data as Record<string, unknown>;
        return {
          tenantId,
          catalogId: catalog.id,
          name: (d.name as string).trim(),
          brand: typeof d.brand === "string" ? d.brand : null,
          description: typeof d.description === "string" ? d.description : null,
          price: typeof d.price === "number" ? d.price : null,
          imageUrl: typeof d.imageUrl === "string" ? d.imageUrl : null,
          purchaseUrl: typeof d.purchaseUrl === "string" ? d.purchaseUrl : null,
          tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
          attributes:
            typeof d.attributes === "object" && d.attributes !== null && !Array.isArray(d.attributes)
              ? (d.attributes as object)
              : {},
          active: typeof d.active === "boolean" ? d.active : true,
          featured: typeof d.featured === "boolean" ? d.featured : false,
        };
      }),
    });
    createdIds = products.map((p) => p.id);
  } catch (err) {
    await prisma.importBatch.update({ where: batchKey, data: { status: "failed" } }).catch(console.error);
    throw err;
  }

  // Embeddings locaux (poapoai, sans OpenAI) en arrière-plan : ils pèsent 60 % du score de recommandation.
  // Aucun état de préparation n'est exposé par l'API : on indique seulement si la demande a été lancée.
  const embeddings = createdIds.length === 0 ? "none" : process.env.AI_SERVICE_URL ? "queued" : "unavailable";
  const result = { created: createdIds.length, skipped: evaluations.length - createdIds.length, errors, embeddings, catalog: toCatalogRef(catalog) };
  await prisma.importBatch.update({ where: batchKey, data: { status: "completed", result: result as unknown as Prisma.InputJsonObject } });
  if (embeddings === "queued") triggerEmbeddings(createdIds, tenantId).catch(console.error);
  res.json(result);
}));

export default router;
