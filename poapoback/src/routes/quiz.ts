import { Router, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import type { QuizSubmitPayload, MetricType } from "@poapo/types";
import { publicQuizScope, adminQuizScope, getQuiz, asyncRoute } from "../services/quizzes";
import { parseAxes } from "../services/axes";
import { recommendQuiz } from "../services/quizRecommendations";
import { QuizError } from "../services/quizzes";
import { EntitlementError, findReplay, parseIdempotencyKey, recordServedRecommendation, requireFeature, submissionFingerprint } from "../services/entitlements";
import { validateTrackEvent, validateFeedback, signFeedbackToken, verifyFeedbackToken } from "../services/analyticsEvents";
import { abandonCounts, buildSteps, buildVariants, computeIndicators, stepRows, variantRows } from "../services/quizMetrics";
import { localInsightsFromSnapshot, type MetricsSnapshot } from "../services/quizInsights";

const router = Router();

async function generateOpenAIInsights(snapshot: MetricsSnapshot, industry: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    `Tu es analyste CRO senior pour un quiz de recommandation e-commerce${industry ? ` (activité : ${industry})` : ""}.`,
    "Analyse ces métriques et retourne uniquement un JSON valide avec la forme:",
    '{"insights":[{"title":"...","insight":"...","priority":"high|medium|low","actions":["...","..."]}]}',
    "3 insights maximum, concis, orientés action.",
    "Règles : productClicks sont des clics vers une fiche produit, jamais des ventes ni des conversions.",
    "clicksPer100Recommendations est indicatif (clics non rattachés à une session) : ne le présente jamais comme un CTR ou un taux de conversion.",
    "Un indicateur dont reliable vaut false ne doit pas être interprété comme une performance ; recentAbandons est une collecte partielle, pas un taux.",
    "N'invente aucune donnée absente (ventes, chiffre d'affaires, visiteurs uniques, temps de complétion, satisfaction, campagnes).",
    `Métriques: ${JSON.stringify(snapshot)}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Réponds uniquement en JSON valide, sans markdown." },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const insights = (parsed as { insights?: unknown[] }).insights;
  if (!Array.isArray(insights)) return null;

  return insights
    .map((item) => {
      const it = item as Record<string, unknown>;
      const priority = String(it.priority ?? "medium");
      const safePriority: "high" | "medium" | "low" = priority === "high" || priority === "low" ? priority : "medium";
      return {
        title: String(it.title ?? "Insight"),
        insight: String(it.insight ?? ""),
        priority: safePriority,
        actions: Array.isArray(it.actions) ? it.actions.map((a) => String(a)).slice(0, 4) : [],
      };
    })
    .filter((i) => i.insight)
    .slice(0, 3);
}

// ─── Public routes ────────────────────────────────────────────────────────────

// GET /api/quiz/questions?clientId=
router.get("/questions", publicQuizScope, asyncRoute(async (req: Request, res: Response) => {
  const { clientId } = req.query as { clientId?: string };
  if (!clientId) {
    res.status(400).json({ error: "clientId manquant" });
    return;
  }
  const questions = await prisma.question.findMany({
    where: { tenantId: clientId, quizId: getQuiz(res).id, active: true },
    orderBy: { order: "asc" },
    include: {
      answers: {
        where: { active: true },
        orderBy: { order: "asc" },
      },
    },
  });
  res.json(questions);
}));

// POST /api/quiz/submit
router.post("/submit", publicQuizScope, async (req: Request, res: Response) => {
  const body = req.body as QuizSubmitPayload;
  const { clientId, answers, decisionTime, abVariant } = body as QuizSubmitPayload & { abVariant?: string };

  if (!clientId) {
    res.status(400).json({ error: "clientId manquant" });
    return;
  }
  if (!Array.isArray(answers) || answers.length === 0 ||
      answers.some((answer) => !answer || typeof answer.answerId !== "string" || typeof answer.questionId !== "string") ||
      new Set(answers.map((answer) => answer.answerId)).size !== answers.length) {
    res.status(400).json({ error: "Réponses invalides ou dupliquées" });
    return;
  }

  let idempotencyKey: string | null;
  try {
    idempotencyKey = parseIdempotencyKey((body as { idempotencyKey?: unknown }).idempotencyKey);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) {
    res.status(503).json({ error: "Service IA non disponible" });
    return;
  }

  try {
    const quiz = getQuiz(res);
    const fingerprint = submissionFingerprint(quiz.id, answers);
    // Retry d'une soumission déjà servie : même réponse, aucune consommation ; clé réutilisée avec un autre contenu : 422.
    const replay = await findReplay<object>(clientId, idempotencyKey, fingerprint);
    if (replay) {
      res.json(replay);
      return;
    }
    const productIds = quiz.useAllProducts ? undefined : quiz.products.map((product) => product.productId);
    if (productIds && productIds.length === 0) {
      res.status(422).json({ error: "Aucun produit sélectionné pour ce quiz" });
      return;
    }

    const answerDocs = await prisma.answer.findMany({
      where: { id: { in: answers.map((a) => a.answerId) }, active: true, question: { tenantId: clientId, quizId: quiz.id, active: true } },
      include: { question: { select: { type: true } } },
    });
    if (answerDocs.length !== answers.length ||
        answers.some((answer) => !answerDocs.some((doc) => doc.id === answer.answerId && doc.questionId === answer.questionId)) ||
        answerDocs.some((doc) => doc.question.type !== "multi" && answers.filter((a) => a.questionId === doc.questionId).length > 1)) {
      res.status(400).json({ error: "Certaines réponses sont invalides pour ce quiz" });
      return;
    }

    const axes = parseAxes(quiz.axes);
    const { product, explanation, profileSummary } = await recommendQuiz({
      tenantId: clientId, catalogId: quiz.catalogId, industry: quiz.industry,
      axes, productIds, impacts: answerDocs.map((ans) => ans.impacts),
    });

    // La session et la consommation du quota sont créées dans la même transaction (rien n'est consommé en cas d'échec).
    const { response } = await recordServedRecommendation({ tenantId: clientId, key: idempotencyKey, fingerprint, create: async (tx) => {
    const session = await tx.quizSession.create({
      data: {
        tenantId: clientId,
        quizId: quiz.id,
        answers: answers as unknown as object,
        resultProductId: product.id,
        decisionTime: typeof decisionTime === "number" && Number.isInteger(decisionTime) && decisionTime >= 0 && decisionTime <= 86_400_000 ? decisionTime : null,
        abVariant: typeof abVariant === "string" && abVariant.trim() && abVariant.length <= 40 ? abVariant : null,
        completedAt: new Date(),
      },
    });

    return { sessionId: session.id, feedbackToken: signFeedbackToken(session.id, clientId, quiz.id), quizId: quiz.id, industry: quiz.industry, product, explanation, profileSummary };
    } });
    res.json(response);
  } catch (err) {
    if (err instanceof EntitlementError) {
      // Réponse publique : code stable et message neutre, sans fuite de plan ni de limite.
      res.status(429).json({ error: "Les recommandations sont momentanément indisponibles pour cette boutique.", code: err.code });
      return;
    }
    if (err instanceof QuizError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("[quiz] submit error:", err);
    res.status(500).json({ error: "Erreur lors du calcul de la recommandation" });
  }
});

// POST /api/quiz/track
router.post("/track", publicQuizScope, asyncRoute(async (req: Request, res: Response) => {
  const { clientId, type, payload } = req.body as { clientId?: string; type?: unknown; payload?: unknown };
  if (!clientId || !type) {
    res.status(400).json({ error: "clientId et type requis" });
    return;
  }
  const event = validateTrackEvent(type, payload);
  if (!event.ok) {
    res.status(400).json({ error: event.error });
    return;
  }

  await prisma.metric.create({
    data: {
      tenantId: clientId,
      quizId: getQuiz(res).id,
      type: type as MetricType,
      payload: event.payload as Prisma.InputJsonObject,
    },
  });

  res.json({ ok: true });
}));

// POST /api/quiz/feedback — le sessionId seul ne prouve rien : il faut le jeton émis par /submit pour ce tenant et ce quiz.
router.post("/feedback", publicQuizScope, asyncRoute(async (req: Request, res: Response) => {
  const { clientId, sessionId, feedbackToken, feedback, reasons } = req.body as {
    clientId: string; sessionId?: unknown; feedbackToken?: unknown; feedback?: unknown; reasons?: unknown;
  };
  const quizId = getQuiz(res).id;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100) {
    res.status(400).json({ error: "sessionId requis" });
    return;
  }
  const parsed = validateFeedback(feedback, reasons);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (!verifyFeedbackToken(feedbackToken, sessionId, clientId, quizId)) {
    res.status(403).json({ error: "Autorisation de retour invalide" });
    return;
  }

  const updated = await prisma.quizSession.updateMany({
    where: { id: sessionId, tenantId: clientId, quizId },
    data: { feedback: parsed.feedback, feedbackReasons: parsed.reasons },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Session introuvable" });
    return;
  }

  res.json({ ok: true });
}));

// ─── Protected — dashboard métriques ────────────────────────────────────────

// GET /api/quiz/metrics
router.get("/metrics", verifyToken, requireFeature("advancedAnalytics", ["GET"]), adminQuizScope, asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const quizId = getQuiz(res).id;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30j par défaut
  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ error: "Date de début invalide" });
    return;
  }

  const [totalStarted, totalCompleted, abandons, totalBuyClicks, recommendations, feedbackStats, topProducts, stepData, variantData] =
    await Promise.all([
      prisma.metric.count({ where: { tenantId, quizId, type: "quiz_start", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, quizId, type: "quiz_complete", createdAt: { gte: since } } }),
      abandonCounts(tenantId, quizId, since),
      prisma.metric.count({ where: { tenantId, quizId, type: "buy_click", createdAt: { gte: since } } }),
      prisma.quizSession.count({ where: { tenantId, quizId, completedAt: { gte: since } } }),
      prisma.quizSession.groupBy({
        by: ["feedback"],
        where: { tenantId, quizId, feedback: { not: null }, createdAt: { gte: since } },
        _count: true,
      }),
      prisma.quizSession.groupBy({
        by: ["resultProductId"],
        where: { tenantId, quizId, resultProductId: { not: null }, completedAt: { gte: since } },
        _count: true,
        orderBy: { _count: { resultProductId: "desc" } },
        take: 5,
      }),
      stepRows(tenantId, quizId, since),
      variantRows(tenantId, quizId, since),
    ]);

  const completionRate = totalStarted > 0 ? Math.round((totalCompleted / totalStarted) * 100) : 0;
  const indicators = computeIndicators({
    started: totalStarted, completed: totalCompleted, recommendations, productClicks: totalBuyClicks,
  });

  type FeedbackRow = { feedback: string | null; _count: number };
  type TopProductRow = { resultProductId: string | null; _count: number };

  const thumbsUp = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "positive")?._count ?? 0;
  const thumbsDown = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "negative")?._count ?? 0;
  const steps = buildSteps(stepData);
  const variantPerformance = buildVariants(variantData);

  // Résoudre les noms des top produits
  const productIds = (topProducts as TopProductRow[]).map((p) => p.resultProductId).filter(Boolean) as string[];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, brand: true },
  });
  const productMap = Object.fromEntries(products.map((p: { id: string; name: string; brand: string | null }) => [p.id, p]));

  res.json({
    period: { from: since, to: new Date() },
    funnel: {
      started: totalStarted,
      completed: totalCompleted,
      // Uniquement les abandons émis par le widget corrigé (avec `reason`) ; les anciens sont comptés à part.
      abandoned: abandons.reliable,
      legacyAbandonEvents: abandons.legacy,
      completionRate,
    },
    indicators,
    cta: {
      clicks: totalBuyClicks,
      clickThroughRate: totalCompleted > 0 ? Math.round((totalBuyClicks / totalCompleted) * 100) : 0,
    },
    steps,
    variants: variantPerformance,
    // Legacy keys kept for compatibility with existing clients
    quizStarted: totalStarted,
    quizCompleted: totalCompleted,
    completionRate,
    buyClicks: totalBuyClicks,
    buyClickRate: totalCompleted > 0 ? Math.round((totalBuyClicks / totalCompleted) * 100) : 0,
    feedback: { positive: thumbsUp, negative: thumbsDown },
    topProducts: (topProducts as TopProductRow[]).map((p) => ({
      product: productMap[p.resultProductId ?? ""] ?? { id: p.resultProductId, name: "Inconnu" },
      count: p._count,
    })),
  });
}));

// GET /api/quiz/metrics/ai-insights
router.get("/metrics/ai-insights", verifyToken, requireFeature("advancedAnalytics", ["GET"]), adminQuizScope, asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const quizId = getQuiz(res).id;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ error: "Date de début invalide" });
    return;
  }

  const [started, completed, abandons, productClicks, recommendations, topProducts, stepData] = await Promise.all([
    prisma.metric.count({ where: { tenantId, quizId, type: "quiz_start", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, quizId, type: "quiz_complete", createdAt: { gte: since } } }),
    abandonCounts(tenantId, quizId, since),
    prisma.metric.count({ where: { tenantId, quizId, type: "buy_click", createdAt: { gte: since } } }),
    prisma.quizSession.count({ where: { tenantId, quizId, completedAt: { gte: since } } }),
    prisma.quizSession.groupBy({
      by: ["resultProductId"],
      where: { tenantId, quizId, resultProductId: { not: null }, completedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { resultProductId: "desc" } },
      take: 3,
    }),
    stepRows(tenantId, quizId, since),
  ]);

  type TopProductRow = { resultProductId: string | null; _count: number };

  const indicators = computeIndicators({ started, completed, recommendations, productClicks });
  const unansweredSteps = buildSteps(stepData)
    .map(({ step, views, answers }) => ({ step, views, answers }))
    .filter((s) => s.views > s.answers)
    .sort((a, b) => (b.views - b.answers) - (a.views - a.answers))
    .slice(0, 3);

  const productIds = (topProducts as TopProductRow[]).map((p) => p.resultProductId).filter(Boolean) as string[];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

  const snapshot: MetricsSnapshot = {
    started,
    completed,
    recommendations,
    productClicks,
    recentAbandons: abandons.reliable,
    completionRate: indicators.completionRate,
    clicksPer100Recommendations: indicators.clicksPer100Recommendations,
    consistent: indicators.consistency.consistent,
    topProducts: (topProducts as TopProductRow[]).map((p) => ({
      name: productMap[p.resultProductId ?? ""] ?? "Inconnu",
      count: p._count,
    })),
    unansweredSteps,
  };

  const aiInsights = await generateOpenAIInsights(snapshot, getQuiz(res).industry);
  if (aiInsights && aiInsights.length > 0) {
    res.json({ source: "openai", generatedAt: new Date(), insights: aiInsights });
    return;
  }

  res.json({ source: "fallback", generatedAt: new Date(), insights: localInsightsFromSnapshot(snapshot) });
}));

export default router;
