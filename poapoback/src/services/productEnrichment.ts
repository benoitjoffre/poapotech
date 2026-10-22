import type { Prisma } from "@prisma/client";
import type {
  AxisEstimate,
  AxisEstimateConfidence,
  EnrichmentProduct,
  EnrichmentQuizOption,
  ProductEnrichmentApplyResponse,
  ProductEnrichmentUpdate,
  QuizAxis,
} from "@poapo/types";
import { prisma } from "../lib/prisma";
import { isAxisValue, parseAxes } from "./axes";
import { catalogAxes } from "./catalogs";
import { GenerationLimiter } from "./quizGeneration";
import { QuizError } from "./quizzes";

export const ENRICHMENT_LIMITS = {
  /** Produits par appel IA (et par requête d'estimation). */
  batchSize: 10,
  contextProducts: 500,
  applyUpdates: 200,
  descriptionChars: 1000,
  tags: 20,
  attributeKeys: 30,
  attributeChars: 120,
} as const;
/** Délai côté backend : délai OpenAI du service IA (30 s par défaut) + marge réseau. */
export const ENRICHMENT_TIMEOUT_MS = 40_000;
export const MAX_ENRICHMENT_ATTEMPTS = 2;
const CONFIDENCES: readonly AxisEstimateConfidence[] = ["low", "medium", "high"];

const hourlyProducts = Number.parseInt(process.env.ENRICHMENT_HOURLY_PRODUCT_LIMIT ?? "", 10);
/** Quota en produits envoyés à l'IA par heure et par tenant ; une estimation à la fois par tenant. */
export const enrichmentLimiter = new GenerationLimiter(
  Number.isInteger(hourlyProducts) && hourlyProducts > 0 ? hourlyProducts : 200,
  Date.now,
  {
    busy: "Une estimation est déjà en cours pour votre compte",
    quota: (max, remaining) =>
      `Limite de ${max} produits estimés par heure atteinte (${remaining} restant${remaining > 1 ? "s" : ""}) : réduisez la sélection ou réessayez plus tard`,
  },
);

// ─── Périmètre : tenant → catalogue → quiz du catalogue ───────────────────────

export interface EnrichmentScope {
  catalog: { id: string; name: string };
  quiz: { id: string; name: string; axes: QuizAxis[] };
  industry: string;
  /** Clés de tous les axes des quiz du catalogue : jamais transmises comme caractéristiques libres. */
  catalogAxisKeys: Set<string>;
}

export async function loadEnrichmentCatalog(tenantId: string, catalogId: unknown) {
  if (typeof catalogId !== "string" || !catalogId) throw new QuizError(404, "Catalogue introuvable");
  const catalog = await prisma.catalog.findFirst({ where: { id: catalogId, tenantId }, select: { id: true, name: true } });
  if (!catalog) throw new QuizError(404, "Catalogue introuvable");
  return catalog;
}

export async function listEnrichmentQuizzes(tenantId: string, catalogId: string): Promise<EnrichmentQuizOption[]> {
  const quizzes = await prisma.quiz.findMany({
    where: { tenantId, catalogId },
    select: { id: true, name: true, active: true, axes: true },
    orderBy: { createdAt: "asc" },
  });
  return quizzes.map((quiz) => ({ id: quiz.id, name: quiz.name, active: quiz.active, axes: parseAxes(quiz.axes) }));
}

export async function loadEnrichmentScope(tenantId: string, catalogId: unknown, quizId: unknown): Promise<EnrichmentScope> {
  const catalog = await loadEnrichmentCatalog(tenantId, catalogId);
  if (typeof quizId !== "string" || !quizId) throw new QuizError(400, "quizId requis");
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, tenantId, catalogId: catalog.id },
    select: { id: true, name: true, industry: true, axes: true, tenant: { select: { industry: true } } },
  });
  if (!quiz) throw new QuizError(404, "Quiz introuvable dans ce catalogue");
  const axes = parseAxes(quiz.axes);
  if (!axes.length) throw new QuizError(422, "Ce quiz n'a aucun axe de recommandation à estimer");
  const allAxes = await catalogAxes(tenantId, catalog.id);
  return {
    catalog,
    quiz: { id: quiz.id, name: quiz.name, axes },
    industry: quiz.industry.trim() || quiz.tenant.industry.trim(),
    catalogAxisKeys: new Set([...allAxes, ...axes].map((axis) => axis.key)),
  };
}

// ─── Données produit transmises à l'IA ────────────────────────────────────────

const productSelect = {
  id: true,
  name: true,
  brand: true,
  active: true,
  description: true,
  tags: true,
  price: true,
  attributes: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type EnrichmentProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function attributesOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Caractéristiques libres (hors axes du catalogue), réduites à des textes courts. */
export function freeAttributes(raw: unknown, excludedKeys: ReadonlySet<string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributesOf(raw))) {
    if (Object.keys(result).length >= ENRICHMENT_LIMITS.attributeKeys) break;
    if (excludedKeys.has(key) || value === null || value === undefined) continue;
    const text = (typeof value === "object" ? JSON.stringify(value) : String(value)).trim();
    if (text) result[key.slice(0, 60)] = text.slice(0, ENRICHMENT_LIMITS.attributeChars);
  }
  return result;
}

/** Une fiche réduite à son nom ne suffit pas : on n'interroge pas l'IA (aucune caractéristique à inventer). */
export function hasProductData(product: Pick<EnrichmentProductRow, "description" | "tags" | "attributes">, excludedKeys: ReadonlySet<string>) {
  return Boolean(product.description?.trim()) || product.tags.some((tag) => tag.trim()) || Object.keys(freeAttributes(product.attributes, excludedKeys)).length > 0;
}

export function currentAxisValues(raw: unknown, axisKeys: string[]): Record<string, number | null> {
  const attributes = attributesOf(raw);
  return Object.fromEntries(axisKeys.map((key) => [key, isAxisValue(attributes[key]) ? attributes[key] : null]));
}

export function invalidAxisKeys(raw: unknown, axisKeys: string[]): string[] {
  const attributes = attributesOf(raw);
  return axisKeys.filter((key) => key in attributes && attributes[key] !== null && !isAxisValue(attributes[key]));
}

export async function listEnrichmentProducts(tenantId: string, scope: Pick<EnrichmentScope, "catalog" | "catalogAxisKeys">, axisKeys: string[]): Promise<EnrichmentProduct[]> {
  const rows = await prisma.product.findMany({
    where: { tenantId, catalogId: scope.catalog.id },
    select: productSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: ENRICHMENT_LIMITS.contextProducts,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    active: row.active,
    axisValues: currentAxisValues(row.attributes, axisKeys),
    invalidAxes: invalidAxisKeys(row.attributes, axisKeys),
    hasData: hasProductData(row, scope.catalogAxisKeys),
  }));
}

// ─── Estimation ───────────────────────────────────────────────────────────────

function parseIds(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) throw new QuizError(400, `${field} doit être une liste d'identifiants`);
  const ids = [...new Set(value as string[])];
  if (!ids.length) throw new QuizError(400, `${field} ne peut pas être vide`);
  if (ids.length > max) throw new QuizError(400, `${max} éléments maximum dans ${field}`);
  return ids;
}

export function parseEstimateInput(raw: unknown, scope: EnrichmentScope) {
  const body = attributesOf(raw);
  const axisKeys = parseIds(body.axisKeys, "axisKeys", 12);
  const known = new Set(scope.quiz.axes.map((axis) => axis.key));
  const unknown = axisKeys.filter((key) => !known.has(key));
  if (unknown.length) throw new QuizError(400, `Axes absents du quiz : ${unknown.join(", ")}`);
  const productIds = parseIds(body.productIds, "productIds", ENRICHMENT_LIMITS.batchSize);
  return { axisKeys, productIds };
}

/** Charge les produits demandés en vérifiant qu'ils appartiennent tous au tenant et au catalogue. */
export async function loadEnrichmentProducts(tenantId: string, catalogId: string, productIds: string[]) {
  const rows = await prisma.product.findMany({ where: { tenantId, catalogId, id: { in: productIds } }, select: productSelect });
  if (rows.length !== productIds.length) throw new QuizError(400, "Certains produits n'appartiennent pas à ce catalogue");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return productIds.map((id) => byId.get(id)!);
}

export interface EnrichmentBatch {
  /** Référence locale (p1, p2…) → produit : les identifiants réels ne quittent jamais le backend. */
  refs: Map<string, EnrichmentProductRow>;
  /** Texte transmis par référence, pour vérifier que les extraits cités en proviennent. */
  texts: Map<string, string>;
  products: Record<string, unknown>[];
}

export function buildEnrichmentBatch(products: EnrichmentProductRow[], excludedKeys: ReadonlySet<string>): EnrichmentBatch {
  const refs = new Map<string, EnrichmentProductRow>();
  const texts = new Map<string, string>();
  const payload = products.map((product, index) => {
    const ref = `p${index + 1}`;
    const item = {
      ref,
      name: product.name.slice(0, 200),
      brand: product.brand?.slice(0, 120) || null,
      description: product.description?.trim().slice(0, ENRICHMENT_LIMITS.descriptionChars) || null,
      tags: product.tags.map((tag) => tag.trim().slice(0, 60)).filter(Boolean).slice(0, ENRICHMENT_LIMITS.tags),
      price: product.price,
      attributes: freeAttributes(product.attributes, excludedKeys),
    };
    refs.set(ref, product);
    texts.set(ref, normalizeText([item.name, item.brand, item.description, ...item.tags, item.price, ...Object.entries(item.attributes).flat()].filter((v) => v !== null && v !== undefined).join(" ")));
    return item;
  });
  return { refs, texts, products: payload };
}

export function buildEnrichmentRequest(scope: EnrichmentScope, axisKeys: string[], batch: EnrichmentBatch, feedback: string[]) {
  const wanted = new Set(axisKeys);
  return {
    industry: scope.industry.slice(0, 80),
    axes: scope.quiz.axes.filter((axis) => wanted.has(axis.key)),
    products: batch.products,
    feedback,
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
}

export function insufficientEstimates(axisKeys: string[], rationale: string): AxisEstimate[] {
  return axisKeys.map((axis) => ({ axis, status: "insufficient_data", value: null, confidence: null, rationale, evidence: [] }));
}

export interface NormalizedEnrichment {
  estimates: Map<string, AxisEstimate[]>;
  errors: string[];
  unverifiedEvidence: number;
}

/**
 * Revalide la réponse du service IA (défense en profondeur) et la convertit en identifiants réels.
 * Les extraits introuvables dans la fiche transmise sont écartés ; une estimation sans aucun extrait vérifiable
 * voit sa confiance ramenée à « low ».
 */
export function normalizeEnrichment(raw: unknown, batch: EnrichmentBatch, axisKeys: string[]): NormalizedEnrichment {
  const errors: string[] = [];
  const estimates = new Map<string, AxisEstimate[]>();
  let unverifiedEvidence = 0;
  const products = Array.isArray(attributesOf(raw).products) ? (attributesOf(raw).products as unknown[]) : null;
  if (!products) return { estimates, errors: ["Réponse sans liste de produits"], unverifiedEvidence };

  for (const item of products) {
    const entry = attributesOf(item);
    const ref = typeof entry.ref === "string" ? entry.ref : "";
    const product = batch.refs.get(ref);
    if (!product) {
      errors.push(`Produit inconnu : ${ref || "(vide)"}`);
      continue;
    }
    if (estimates.has(product.id)) {
      errors.push(`Produit en double : ${ref}`);
      continue;
    }
    const byAxis = new Map<string, AxisEstimate>();
    const source = batch.texts.get(ref) ?? "";
    for (const rawEstimate of Array.isArray(entry.estimates) ? entry.estimates : []) {
      const e = attributesOf(rawEstimate);
      const axis = typeof e.axis === "string" ? e.axis : "";
      if (!axisKeys.includes(axis) || byAxis.has(axis)) {
        errors.push(`${ref} : axe inconnu ou en double (${axis || "vide"})`);
        continue;
      }
      const rationale = typeof e.rationale === "string" ? e.rationale.trim().slice(0, 300) : "";
      if (e.status === "insufficient_data") {
        if (e.value !== null && e.value !== undefined) errors.push(`${ref}.${axis} : value doit être null si les données sont insuffisantes`);
        byAxis.set(axis, { axis, status: "insufficient_data", value: null, confidence: null, rationale: rationale || "Données insuffisantes", evidence: [] });
        continue;
      }
      if (e.status !== "estimated" || !isAxisValue(e.value)) {
        errors.push(`${ref}.${axis} : estimation invalide (valeur entre 0 et 1 requise)`);
        continue;
      }
      let confidence = CONFIDENCES.includes(e.confidence as AxisEstimateConfidence) ? (e.confidence as AxisEstimateConfidence) : null;
      if (!confidence) {
        errors.push(`${ref}.${axis} : confidence requise`);
        continue;
      }
      const evidence = (Array.isArray(e.evidence) ? e.evidence : [])
        .filter((quote): quote is string => typeof quote === "string" && quote.trim().length > 0)
        .map((quote) => quote.trim().slice(0, 120));
      const verified = evidence.filter((quote) => source.includes(normalizeText(quote))).slice(0, 3);
      if (verified.length < evidence.length) unverifiedEvidence += evidence.length - verified.length;
      if (!verified.length && confidence !== "low") confidence = "low";
      byAxis.set(axis, { axis, status: "estimated", value: Math.round(e.value * 100) / 100, confidence, rationale, evidence: verified });
    }
    const missing = axisKeys.filter((key) => !byAxis.has(key));
    if (missing.length) errors.push(`${ref} : estimations manquantes pour ${missing.join(", ")}`);
    estimates.set(product.id, axisKeys.map((key) => byAxis.get(key)!).filter(Boolean));
  }
  const missingRefs = [...batch.refs].filter(([, product]) => !estimates.has(product.id)).map(([ref]) => ref);
  if (missingRefs.length) errors.push(`Produits sans estimation : ${missingRefs.join(", ")}`);
  return { estimates, errors, unverifiedEvidence };
}

// ─── Enregistrement des valeurs validées ──────────────────────────────────────

function parseValueMap(value: unknown, field: string, allowNull: boolean): Record<string, number | null> {
  const map = attributesOf(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new QuizError(400, `${field} doit être un objet`);
  for (const [key, item] of Object.entries(map)) {
    if (allowNull && item === null) continue;
    if (!isAxisValue(item)) throw new QuizError(400, `${field}.${key} doit être un nombre entre 0 et 1`);
  }
  return map as Record<string, number | null>;
}

export function parseApplyInput(raw: unknown, scope: EnrichmentScope): ProductEnrichmentUpdate[] {
  const body = attributesOf(raw);
  if (!Array.isArray(body.updates) || !body.updates.length) throw new QuizError(400, "updates ne peut pas être vide");
  if (body.updates.length > ENRICHMENT_LIMITS.applyUpdates) throw new QuizError(400, `${ENRICHMENT_LIMITS.applyUpdates} produits maximum par enregistrement`);
  const axisKeys = new Set(scope.quiz.axes.map((axis) => axis.key));
  const seen = new Set<string>();
  return body.updates.map((rawUpdate) => {
    const update = attributesOf(rawUpdate);
    const productId = typeof update.productId === "string" ? update.productId : "";
    if (!productId) throw new QuizError(400, "productId requis");
    if (seen.has(productId)) throw new QuizError(400, `Produit en double : ${productId}`);
    seen.add(productId);
    const values = parseValueMap(update.values, "values", false) as Record<string, number>;
    const expected = parseValueMap(update.expected ?? {}, "expected", true);
    const keys = Object.keys(values);
    if (!keys.length) throw new QuizError(400, "Chaque produit doit contenir au moins une valeur validée");
    const unknown = keys.filter((key) => !axisKeys.has(key));
    if (unknown.length) throw new QuizError(400, `Axes absents du quiz : ${unknown.join(", ")}`);
    const withoutExpected = keys.filter((key) => !(key in expected));
    if (withoutExpected.length) throw new QuizError(400, `expected doit indiquer la valeur actuelle de : ${withoutExpected.join(", ")}`);
    if (!Array.isArray(update.overwrite) || update.overwrite.some((key) => typeof key !== "string" || !(key in values))) {
      throw new QuizError(400, "overwrite doit lister des axes présents dans values");
    }
    return {
      productId,
      values: Object.fromEntries(keys.map((key) => [key, Math.round(values[key] * 100) / 100])),
      expected,
      overwrite: [...new Set(update.overwrite as string[])],
    };
  });
}

const sameValue = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/**
 * Écrit les valeurs validées dans Product.attributes (autres clés conservées), en une transaction :
 * tout produit dont une valeur existante n'est pas explicitement remplacée, ou qui a changé depuis
 * son affichage, fait échouer l'ensemble (409).
 */
export async function applyEnrichment(
  tenantId: string,
  catalogId: string,
  updates: ProductEnrichmentUpdate[],
): Promise<ProductEnrichmentApplyResponse & { productIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    const ids = updates.map((update) => update.productId);
    const rows = await tx.product.findMany({
      where: { tenantId, catalogId, id: { in: ids } },
      select: { id: true, name: true, attributes: true, updatedAt: true },
    });
    if (rows.length !== ids.length) throw new QuizError(400, "Certains produits n'appartiennent pas à ce catalogue");
    const byId = new Map(rows.map((row) => [row.id, row]));

    const conflicts: string[] = [];
    let added = 0;
    let replaced = 0;
    const writes = updates.map((update) => {
      const row = byId.get(update.productId)!;
      const attributes = attributesOf(row.attributes);
      for (const key of Object.keys(update.values)) {
        const current = attributes[key];
        const exists = current !== null && current !== undefined;
        // Valeur telle qu'affichée au commerçant : une valeur non numérique apparaît comme absente mais reste à confirmer.
        const shown = isAxisValue(current) ? current : null;
        if (!sameValue(shown, update.expected[key] ?? null)) {
          conflicts.push(`${row.name} (${key}) : valeur modifiée depuis l'estimation`);
        } else if (exists && !update.overwrite.includes(key)) {
          conflicts.push(`${row.name} (${key}) : remplacement de la valeur existante non confirmé`);
        } else if (exists) {
          replaced++;
        } else {
          added++;
        }
      }
      return { row, attributes: { ...attributes, ...update.values } };
    });
    if (conflicts.length) {
      const more = conflicts.length > 5 ? ` (+${conflicts.length - 5})` : "";
      throw new QuizError(409, `Aucune valeur enregistrée. ${conflicts.slice(0, 5).join(" ; ")}${more}`);
    }

    for (const { row, attributes } of writes) {
      // Verrou optimiste : l'écriture échoue si le produit a été modifié depuis sa lecture.
      const result = await tx.product.updateMany({
        where: { id: row.id, tenantId, catalogId, updatedAt: row.updatedAt },
        data: { attributes: attributes as Prisma.InputJsonValue },
      });
      if (result.count !== 1) throw new QuizError(409, `Aucune valeur enregistrée : « ${row.name} » a été modifié entre-temps`);
    }
    return { updatedProducts: writes.length, added, replaced, productIds: ids };
  });
}
