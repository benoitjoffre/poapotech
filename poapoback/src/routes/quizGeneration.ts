import { Router } from "express";
import type { Request } from "express";
import type {
  GeneratedQuizDraft,
  ProfileSummary,
  QuizDraftPreviewResponse,
  QuizDraftSaveResponse,
  QuizGenerationContext,
} from "@poapo/types";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { AiServiceError, callAiService } from "../services/aiClient";
import { effectiveStatus } from "../services/campaigns";
import { createQuestionsWithAnswers } from "../services/questions";
import {
  buildAiRequest,
  GENERATION_LIMITS,
  GENERATION_TIMEOUT_MS,
  generationLimiter,
  listContextProducts,
  loadGenerationScope,
  loadSelectedProducts,
  MAX_GENERATION_ATTEMPTS,
  normalizeGeneratedQuiz,
  parseDraft,
  parseGenerationInput,
  planGeneration,
  PREVIEW_TIMEOUT_MS,
} from "../services/quizGeneration";
import { asyncRoute, createQuiz, ensureDefaultQuiz, QuizError } from "../services/quizzes";
import { computeProfile } from "../services/scoring";

// Monté sous /api/campaigns/:id/quiz-generation, après verifyToken et le contrôle du tenant.
const router = Router({ mergeParams: true });

function tenantOf(req: Request) {
  return (req as AuthRequest).tenant!.tenantId;
}

function toHttpError(err: unknown): unknown {
  if (!(err instanceof AiServiceError)) return err;
  switch (err.kind) {
    case "timeout":
      return new QuizError(504, "Le service IA n'a pas répondu à temps, réessayez dans un instant");
    case "invalid_output":
      return new QuizError(502, "La réponse de l'IA est invalide");
    default:
      return new QuizError(503, "Service IA indisponible");
  }
}

// GET …/context — axes du quiz de la campagne, produits actifs et règles de rattachement
router.get("/context", asyncRoute(async (req, res) => {
  const tenantId = tenantOf(req);
  const scope = await loadGenerationScope(tenantId, req.params.id);
  const { campaign } = scope;
  const context: QuizGenerationContext = {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      effectiveStatus: effectiveStatus(campaign),
      occasion: campaign.occasion,
      occasionLabel: campaign.occasionLabel,
      quizId: campaign.quiz.id,
      quizName: campaign.quiz.name,
    },
    industry: scope.industry,
    axes: scope.axes,
    products: await listContextProducts(tenantId, scope.axes),
    canAttach: campaign.status === "DRAFT",
    limits: GENERATION_LIMITS,
  };
  res.json(context);
}));

// POST … — génère un brouillon, sans aucune écriture en base
router.post("/", asyncRoute(async (req, res) => {
  const tenantId = tenantOf(req);
  const scope = await loadGenerationScope(tenantId, req.params.id);
  const input = parseGenerationInput(req.body, scope);
  const products = await loadSelectedProducts(tenantId, input.productIds);
  const plan = planGeneration(scope, input, products);

  const release = generationLimiter.acquire(tenantId);
  const started = Date.now();
  try {
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      let result: { quiz: unknown; model: string };
      try {
        result = await callAiService("/generate/quiz", buildAiRequest(scope, input, plan, feedback), GENERATION_TIMEOUT_MS);
      } catch (err) {
        if (err instanceof AiServiceError && err.kind === "invalid_output" && attempt < MAX_GENERATION_ATTEMPTS) {
          feedback = err.details.length ? err.details.slice(0, 10) : ["Respecte strictement le format demandé."];
          continue;
        }
        throw toHttpError(err);
      }

      const normalized = normalizeGeneratedQuiz(result.quiz, plan, input);
      if (!normalized.errors.length) {
        const response: GeneratedQuizDraft = {
          draft: normalized.draft,
          mode: plan.mode,
          axes: plan.axes,
          industry: scope.industry,
          warnings: [...plan.warnings, ...normalized.warnings],
          generation: { model: String(result.model ?? ""), durationMs: Date.now() - started, attempts: attempt },
        };
        res.json(response);
        return;
      }
      feedback = normalized.errors.slice(0, 10);
    }
    throw new QuizError(502, "La réponse de l'IA reste invalide après une nouvelle tentative, réessayez ou modifiez les paramètres");
  } finally {
    release();
  }
}));

// POST …/preview — une seule recommandation pour les réponses choisies, sans écriture en base
router.post("/preview", asyncRoute(async (req, res) => {
  const tenantId = tenantOf(req);
  const scope = await loadGenerationScope(tenantId, req.params.id);
  const { draft, axes } = parseDraft(req.body?.draft, scope);
  const choices = req.body?.answers;
  if (
    !Array.isArray(choices) ||
    choices.length !== draft.questions.length ||
    choices.some((choice, index) => !Number.isInteger(choice) || choice < 0 || choice >= draft.questions[index].answers.length)
  ) {
    throw new QuizError(400, "Choisissez une réponse pour chaque question");
  }
  const products = await loadSelectedProducts(tenantId, draft.productIds);
  const profile = computeProfile(axes, choices.map((choice: number, index) => draft.questions[index].answers[choice].impacts));

  let result: { productId: string; explanation: string[]; profileSummary: ProfileSummary; topN?: { id: string; score: number }[] };
  try {
    result = await callAiService("/recommend", {
      tenantId,
      profile,
      industry: scope.industry,
      axes,
      productIds: draft.productIds,
      topN: 3,
    }, PREVIEW_TIMEOUT_MS);
  } catch (err) {
    throw toHttpError(err);
  }

  const ranked = result.topN?.length ? result.topN : [{ id: result.productId, score: 0 }];
  const byId = new Map(products.map((product) => [product.id, product]));
  if (ranked.some((item) => !byId.has(item.id))) {
    throw new QuizError(502, "La recommandation renvoyée ne fait pas partie des produits sélectionnés");
  }
  const response: QuizDraftPreviewResponse = {
    profile,
    profileSummary: result.profileSummary,
    explanation: Array.isArray(result.explanation) ? result.explanation.map(String) : [],
    recommendations: ranked.map((item) => {
      const product = byId.get(item.id)!;
      return {
        product: { id: product.id, name: product.name, brand: product.brand, imageUrl: product.imageUrl, price: product.price },
        score: item.score,
      };
    }),
  };
  res.json(response);
}));

// POST …/save — crée un nouveau quiz inactif ; rattachement uniquement à une campagne en brouillon
router.post("/save", asyncRoute(async (req, res) => {
  const tenantId = tenantOf(req);
  const scope = await loadGenerationScope(tenantId, req.params.id);
  const { draft, axes } = parseDraft(req.body?.draft, scope);
  const attachRequested = req.body?.attachToCampaign;
  if (typeof attachRequested !== "boolean") throw new QuizError(400, "attachToCampaign doit être un booléen");
  await loadSelectedProducts(tenantId, draft.productIds);
  await ensureDefaultQuiz(tenantId);

  const result = await prisma.$transaction(async (tx) => {
    const quiz = await createQuiz(tenantId, {
      name: draft.name,
      industry: scope.industry,
      axes,
      quizTitle: draft.quizTitle,
      ctaText: draft.ctaText,
      active: false,
      useAllProducts: false,
      productIds: draft.productIds,
    }, tx);
    const counts = await createQuestionsWithAnswers(tx, { tenantId, quizId: quiz.id, startOrder: 0 }, draft.questions.map((question) => ({
      text: question.text,
      helpText: question.helpText,
      type: "single" as const,
      answers: question.answers.map((answer) => ({ text: answer.text, emoji: answer.emoji, impacts: answer.impacts })),
    })));
    // Le filtre sur le statut enregistré rend le rattachement sûr même si la campagne vient d'être publiée.
    const attached = attachRequested
      ? (await tx.campaign.updateMany({
        where: { id: scope.campaign.id, tenantId, status: "DRAFT" },
        data: { quizId: quiz.id },
      })).count === 1
      : false;
    return { quiz, counts, attached };
  });

  const response: QuizDraftSaveResponse = {
    quizId: result.quiz.id,
    quizName: result.quiz.name,
    questionCount: result.counts.createdQuestions,
    answerCount: result.counts.createdAnswers,
    attachedToCampaign: result.attached,
    attachMessage: attachRequested && !result.attached
      ? "La campagne n'est pas en brouillon : le quiz généré reste indépendant."
      : null,
  };
  res.status(201).json(response);
}));

export default router;
