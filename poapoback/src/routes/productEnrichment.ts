import { Router } from "express";
import type { Request } from "express";
import type {
  ProductEnrichmentApplyResponse,
  ProductEnrichmentContext,
  ProductEnrichmentEstimateResponse,
  ProductEnrichmentResult,
} from "@poapo/types";
import type { AuthRequest } from "../middleware/auth";
import { AiServiceError, callAiService } from "../services/aiClient";
import { resolveAccountTenantId } from "../services/catalogs";
import { triggerEmbeddings } from "../services/embeddings";
import {
  applyEnrichment,
  buildEnrichmentBatch,
  buildEnrichmentRequest,
  currentAxisValues,
  ENRICHMENT_LIMITS,
  ENRICHMENT_TIMEOUT_MS,
  enrichmentLimiter,
  hasProductData,
  insufficientEstimates,
  listEnrichmentProducts,
  listEnrichmentQuizzes,
  loadEnrichmentCatalog,
  loadEnrichmentProducts,
  loadEnrichmentScope,
  MAX_ENRICHMENT_ATTEMPTS,
  normalizeEnrichment,
  parseApplyInput,
  parseEstimateInput,
} from "../services/productEnrichment";
import { asyncRoute, QuizError } from "../services/quizzes";

// Monté sous /api/catalogs/:catalogId/enrichment, après verifyToken.
const router = Router({ mergeParams: true });

async function tenantOf(req: Request): Promise<string> {
  const tenantId = await resolveAccountTenantId(req as AuthRequest);
  if (!tenantId) throw new QuizError(403, "Aucun tenant valide associé à ce compte");
  return tenantId;
}

function toHttpError(err: unknown): unknown {
  if (!(err instanceof AiServiceError)) return err;
  switch (err.kind) {
    case "timeout":
      return new QuizError(504, "Le service IA n'a pas répondu à temps : réessayez ce lot");
    case "invalid_output":
      return new QuizError(502, "La réponse de l'IA est invalide");
    default:
      return new QuizError(503, "Service IA indisponible");
  }
}

const NO_DATA_RATIONALE = "Fiche sans description, tags ni caractéristiques : complétez-la pour permettre une estimation.";

// GET …/context?quizId= — quiz du catalogue, axes et produits avec leurs valeurs actuelles
router.get("/context", asyncRoute(async (req, res) => {
  const tenantId = await tenantOf(req);
  const catalog = await loadEnrichmentCatalog(tenantId, req.params.catalogId);
  const quizzes = await listEnrichmentQuizzes(tenantId, catalog.id);
  const requested = typeof req.query.quizId === "string" ? req.query.quizId : "";
  const quiz = requested
    ? quizzes.find((item) => item.id === requested)
    : quizzes.find((item) => item.active && item.axes.length) ?? quizzes.find((item) => item.axes.length);
  if (requested && !quiz) throw new QuizError(404, "Quiz introuvable dans ce catalogue");

  const scope = quiz?.axes.length ? await loadEnrichmentScope(tenantId, catalog.id, quiz.id) : null;
  const axisKeys = quiz?.axes.map((axis) => axis.key) ?? [];
  const sharedAxes = Object.fromEntries(axisKeys.map((key) => [
    key,
    quizzes.filter((other) => other.id !== quiz!.id && other.axes.some((axis) => axis.key === key)).map((other) => other.name),
  ]));
  const context: ProductEnrichmentContext = {
    catalog,
    quizzes,
    quiz: quiz ?? null,
    products: scope ? await listEnrichmentProducts(tenantId, scope, axisKeys) : [],
    sharedAxes,
    limits: { batchSize: ENRICHMENT_LIMITS.batchSize, hourlyProducts: enrichmentLimiter.limit, remaining: enrichmentLimiter.remaining(tenantId) },
  };
  res.json(context);
}));

// POST …/estimate — propositions de l'IA pour un lot de produits, sans aucune écriture en base
router.post("/estimate", asyncRoute(async (req, res) => {
  const tenantId = await tenantOf(req);
  const scope = await loadEnrichmentScope(tenantId, req.params.catalogId, req.body?.quizId);
  const { axisKeys, productIds } = parseEstimateInput(req.body, scope);
  const products = await loadEnrichmentProducts(tenantId, scope.catalog.id, productIds);

  const estimates = new Map(
    products
      .filter((product) => !hasProductData(product, scope.catalogAxisKeys))
      .map((product) => [product.id, insufficientEstimates(axisKeys, NO_DATA_RATIONALE)]),
  );
  const toEstimate = products.filter((product) => !estimates.has(product.id));
  const warnings: string[] = [];
  if (estimates.size) warnings.push(`${estimates.size} produit(s) sans données descriptives n'ont pas été envoyés à l'IA.`);

  const started = Date.now();
  let attempts = 0;
  let model = "";
  if (toEstimate.length) {
    const release = enrichmentLimiter.acquire(tenantId, toEstimate.length);
    try {
      const batch = buildEnrichmentBatch(toEstimate, scope.catalogAxisKeys);
      let feedback: string[] = [];
      let done = false;
      while (!done) {
        attempts++;
        let result: { products: unknown; model?: string };
        try {
          result = await callAiService("/enrich/axes", buildEnrichmentRequest(scope, axisKeys, batch, feedback), ENRICHMENT_TIMEOUT_MS);
        } catch (err) {
          if (err instanceof AiServiceError && err.kind === "invalid_output" && attempts < MAX_ENRICHMENT_ATTEMPTS) {
            feedback = err.details.length ? err.details.slice(0, 10) : ["Respecte strictement le format demandé."];
            continue;
          }
          throw toHttpError(err);
        }
        const normalized = normalizeEnrichment(result, batch, axisKeys);
        if (!normalized.errors.length) {
          normalized.estimates.forEach((value, key) => estimates.set(key, value));
          if (normalized.unverifiedEvidence) {
            warnings.push(`${normalized.unverifiedEvidence} extrait(s) cité(s) par l'IA sont absents des fiches et ont été écartés.`);
          }
          model = String(result.model ?? "");
          done = true;
        } else if (attempts >= MAX_ENRICHMENT_ATTEMPTS) {
          throw new QuizError(502, "La réponse de l'IA reste invalide après une nouvelle tentative : réessayez ce lot");
        } else {
          feedback = normalized.errors.slice(0, 10);
        }
      }
    } finally {
      release();
    }
  }

  const results: ProductEnrichmentResult[] = products.map((product) => ({
    productId: product.id,
    currentValues: currentAxisValues(product.attributes, axisKeys),
    estimates: estimates.get(product.id)!,
  }));
  const response: ProductEnrichmentEstimateResponse = {
    results,
    warnings,
    generation: { model, durationMs: Date.now() - started, attempts, aiProducts: toEstimate.length },
    remaining: enrichmentLimiter.remaining(tenantId),
  };
  res.json(response);
}));

// POST …/apply — enregistre les valeurs validées par le commerçant
router.post("/apply", asyncRoute(async (req, res) => {
  const tenantId = await tenantOf(req);
  const scope = await loadEnrichmentScope(tenantId, req.params.catalogId, req.body?.quizId);
  const updates = parseApplyInput(req.body, scope);
  const { productIds, ...result } = await applyEnrichment(tenantId, scope.catalog.id, updates);
  // Comme après une modification de fiche : l'embedding inclut les valeurs d'axes.
  triggerEmbeddings(productIds, tenantId).catch(console.error);
  const response: ProductEnrichmentApplyResponse = result;
  res.json(response);
}));

export default router;
