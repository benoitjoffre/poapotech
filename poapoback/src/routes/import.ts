import { Router, Response } from "express";
import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { verifyToken, AuthRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";

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

const ARRAY_FIELDS = new Set(["topNotes", "heartNotes", "baseNotes", "tags", "seasons", "occasions", "timeOfDay"]);
const NUMBER_FIELDS = new Set(["price", "freshness", "intensity", "sweetness"]);
const BOOL_FIELDS = new Set(["active", "featured"]);

function applyMapping(row: Record<string, string>, mapping: FieldMapping[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
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
      const n = parseFloat(raw.replace(",", "."));
      if (!isNaN(n)) result[targetField] = n;
    } else if (BOOL_FIELDS.has(targetField)) {
      result[targetField] = ["true", "1", "oui", "yes"].includes(raw.toLowerCase());
    } else {
      result[targetField] = raw;
    }
  }
  return result;
}

// ─── POST /api/catalog/import/parse ──────────────────────────────────────────
router.post("/parse", verifyToken, upload.single("file"), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier CSV requis" });
    return;
  }

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
          body: JSON.stringify({ headers, sampleRows }),
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

    res.json({ headers, rows, suggestedMapping, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur de parsing";
    res.status(400).json({ error: message });
  }
});

// ─── POST /api/catalog/import/execute ────────────────────────────────────────
router.post("/execute", verifyToken, async (req: AuthRequest, res: Response) => {
  const { mapping, rows } = req.body as {
    mapping: FieldMapping[];
    rows: Record<string, string>[];
  };

  if (!Array.isArray(mapping) || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "mapping et rows requis" });
    return;
  }

  const tenantId = req.tenant!.tenantId;
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const data = applyMapping(row, mapping);
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) {
      skipped++;
      continue;
    }

    try {
      await prisma.product.create({
        data: {
          tenantId,
          name,
          brand: typeof data.brand === "string" ? data.brand : null,
          description: typeof data.description === "string" ? data.description : null,
          price: typeof data.price === "number" ? data.price : null,
          imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : null,
          purchaseUrl: typeof data.purchaseUrl === "string" ? data.purchaseUrl : null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          concentration: (data.concentration as any) ?? null,
          olfactoryFamily: typeof data.olfactoryFamily === "string" ? data.olfactoryFamily : null,
          subFamily: typeof data.subFamily === "string" ? data.subFamily : null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          genderTarget: (data.genderTarget as any) ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          priceTier: (data.priceTier as any) ?? null,
          topNotes: Array.isArray(data.topNotes) ? (data.topNotes as string[]) : [],
          heartNotes: Array.isArray(data.heartNotes) ? (data.heartNotes as string[]) : [],
          baseNotes: Array.isArray(data.baseNotes) ? (data.baseNotes as string[]) : [],
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          freshness: typeof data.freshness === "number" ? data.freshness : null,
          intensity: typeof data.intensity === "number" ? data.intensity : null,
          sweetness: typeof data.sweetness === "number" ? data.sweetness : null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          seasons: Array.isArray(data.seasons) ? (data.seasons as any[]) : [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          occasions: Array.isArray(data.occasions) ? (data.occasions as any[]) : [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          timeOfDay: Array.isArray(data.timeOfDay) ? (data.timeOfDay as any[]) : [],
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

  res.json({ created, skipped, errors });
});

export default router;
