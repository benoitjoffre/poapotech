import { Router, Response } from "express";
import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { verifyToken, AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { catalogAxes, resolveAccountTenantId, resolveCatalog, toCatalogRef } from "../services/catalogs";
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

// ─── Types ────────────────────────────────────────────────────────────────────
export type FieldMapping = { sourceColumn: string; targetField: string | null };

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
const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

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
      if (n !== null) result[targetField] = n;
    } else if (BOOL_FIELDS.has(targetField)) {
      result[targetField] = ["true", "1", "oui", "yes"].includes(raw.toLowerCase());
    } else if (targetField === "attributes") {
      const parsed: unknown = JSON.parse(raw);
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
      throw new Error(`L’axe '${key}' doit être un nombre entre 0 et 1`);
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

    const sampleRows = rows.slice(0, 5);

    // Suggestion de mapping via poapoai (non-bloquant)
    let suggestedMapping: FieldMapping[] = headers.map((h) => ({
      sourceColumn: h,
      targetField: null,
    }));

    const aiUrl = process.env.AI_SERVICE_URL;
    if (aiUrl) {
      try {
        const aiRes = await fetch(`${aiUrl}/map-catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headers, sampleRows, axes }),
        });
        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as { mappings?: FieldMapping[] };
          if (Array.isArray(aiData.mappings) && aiData.mappings.length > 0) {
            suggestedMapping = aiData.mappings;
          }
        }
      } catch {
        // poapoai indisponible — on continue sans suggestion IA
      }
    }

    res.json({ headers, rows, suggestedMapping, total: rows.length, catalog: catalog && toCatalogRef(catalog) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur de parsing";
    res.status(400).json({ error: message });
  }
}));

// ─── POST /api/catalog/import/execute ────────────────────────────────────────
// Corps : { mapping, rows, catalogId? } — catalogId absent : catalogue par défaut du tenant.
router.post("/execute", verifyToken, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { mapping, rows, catalogId } = req.body as {
    mapping: FieldMapping[];
    rows: Record<string, string>[];
    catalogId?: unknown;
  };

  if (!Array.isArray(mapping) || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "mapping et rows requis" });
    return;
  }

  // Le token peut contenir un tenantId logique/invalide (ex: super-admin)
  // ou un ancien tenant supprime. On securise en validant l'existence du tenant.
  const tenantId = await resolveAccountTenantId(req);
  if (!tenantId) {
    res.status(400).json({
      error: "Aucun tenant valide associe a ce compte. Creez/associez un tenant dans l'onglet Tenants puis reconnectez-vous.",
    });
    return;
  }
  const catalog = await resolveCatalog(tenantId, catalogId);
  const axisKeys = new Set((await catalogAxes(tenantId, catalog.id)).map((axis) => axis.key));
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const data = applyMapping(row, mapping, axisKeys);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name) {
        skipped++;
        continue;
      }

      await prisma.product.create({
        data: {
          tenantId,
          catalogId: catalog.id,
          name,
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
      created++;
    } catch (err) {
      skipped++;
      if (errors.length < 5) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  res.json({ created, skipped, errors, catalog: toCatalogRef(catalog) });
}));

export default router;
