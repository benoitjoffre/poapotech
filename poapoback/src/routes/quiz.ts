import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import type { QuizSubmitPayload, MetricType } from "@poapo/types";
import { publicQuizScope, adminQuizScope, getQuiz, asyncRoute } from "../services/quizzes";
import { parseAxes } from "../services/axes";
import { recommendQuiz } from "../services/quizRecommendations";
import { QuizError } from "../services/quizzes";
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

  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) {
    res.status(503).json({ error: "Service IA non disponible" });
    return;
  }

  try {
    const quiz = getQuiz(res);
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

    // Persister la session
    const session = await prisma.quizSession.create({
      data: {
        tenantId: clientId,
        quizId: quiz.id,
        answers: answers as unknown as object,
        resultProductId: product.id,
        decisionTime: decisionTime ?? null,
        abVariant: abVariant ?? null,
        completedAt: new Date(),
      },
    });

    res.json({ sessionId: session.id, quizId: quiz.id, industry: quiz.industry, product, explanation, profileSummary });
  } catch (err) {
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
  const { clientId, type, payload } = req.body as {
    clientId?: string;
    type?: string;
    payload?: Record<string, unknown>;
  };

  if (!clientId || !type) {
    res.status(400).json({ error: "clientId et type requis" });
    return;
  }

  const validTypes: MetricType[] = [
    "quiz_start",
    "quiz_complete",
    "quiz_abandon",
    "step_view",
    "step_answer",
    "buy_click",
    "feedback",
    "decision_time",
  ];

  if (!validTypes.includes(type as MetricType)) {
    res.status(400).json({ error: "Type d'événement invalide" });
    return;
  }

  await prisma.metric.create({
    data: {
      tenantId: clientId,
      quizId: getQuiz(res).id,
      type: type as MetricType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: (payload ?? {}) as any,
    },
  });

  res.json({ ok: true });
}));

// POST /api/quiz/feedback
router.post("/feedback", async (req: Request, res: Response) => {
  const { sessionId, feedback, reasons } = req.body as {
    sessionId?: string;
    feedback?: "positive" | "negative";
    reasons?: string[];
  };

  if (!sessionId || !feedback) {
    res.status(400).json({ error: "sessionId et feedback requis" });
    return;
  }

  await prisma.quizSession.update({
    where: { id: sessionId },
    data: { feedback, feedbackReasons: reasons ?? [] },
  });

  res.json({ ok: true });
});

// ─── Protected — dashboard métriques ────────────────────────────────────────

// GET /api/quiz/metrics
router.get("/metrics", verifyToken, adminQuizScope, asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const quizId = getQuiz(res).id;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30j par défaut
  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ error: "Date de début invalide" });
    return;
  }

  const [totalStarted, totalCompleted, totalAbandoned, totalBuyClicks, feedbackStats, topProducts, stepViews, stepAnswers, abEvents] =
    await Promise.all([
      prisma.metric.count({ where: { tenantId, quizId, type: "quiz_start", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, quizId, type: "quiz_complete", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, quizId, type: "quiz_abandon", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, quizId, type: "buy_click", createdAt: { gte: since } } }),
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
      prisma.metric.findMany({
        where: { tenantId, quizId, type: "step_view", createdAt: { gte: since } },
        select: { payload: true },
      }),
      prisma.metric.findMany({
        where: { tenantId, quizId, type: "step_answer", createdAt: { gte: since } },
        select: { payload: true },
      }),
      prisma.metric.findMany({
        where: { tenantId, quizId, type: { in: ["quiz_start", "quiz_complete", "buy_click"] }, createdAt: { gte: since } },
        select: { type: true, payload: true },
      }),
    ]);

  const completionRate = totalStarted > 0 ? Math.round((totalCompleted / totalStarted) * 100) : 0;

  type FeedbackRow = { feedback: string | null; _count: number };
  type TopProductRow = { resultProductId: string | null; _count: number };

  const thumbsUp = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "positive")?._count ?? 0;
  const thumbsDown = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "negative")?._count ?? 0;

  type MetricPayloadRow = { payload: unknown };
  const viewsByStep = new Map<string, number>();
  const answersByStep = new Map<string, number>();

  for (const row of stepViews as MetricPayloadRow[]) {
    const payload = row.payload as Record<string, unknown>;
    const step = String(payload.step ?? payload.questionId ?? "unknown");
    viewsByStep.set(step, (viewsByStep.get(step) ?? 0) + 1);
  }
  for (const row of stepAnswers as MetricPayloadRow[]) {
    const payload = row.payload as Record<string, unknown>;
    const step = String(payload.step ?? payload.questionId ?? "unknown");
    answersByStep.set(step, (answersByStep.get(step) ?? 0) + 1);
  }

  const stepKeys = new Set<string>([...viewsByStep.keys(), ...answersByStep.keys()]);
  const steps = [...stepKeys]
    .map((step) => {
      const views = viewsByStep.get(step) ?? 0;
      const answers = answersByStep.get(step) ?? 0;
      const dropOffRate = views > 0 ? Math.round(((views - answers) / views) * 100) : 0;
      return { step, views, answers, dropOffRate };
    })
    .sort((a, b) => b.views - a.views);

  type AbMetricRow = { type: MetricType; payload: unknown };
  const variants = new Map<string, { started: number; completed: number; clicks: number }>();
  for (const row of abEvents as AbMetricRow[]) {
    const payload =
      typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const variant = typeof payload.abVariant === "string" && payload.abVariant.trim() ? payload.abVariant.trim() : "standard";
    const counts = variants.get(variant) ?? { started: 0, completed: 0, clicks: 0 };
    if (row.type === "quiz_start") counts.started++;
    if (row.type === "quiz_complete") counts.completed++;
    if (row.type === "buy_click") counts.clicks++;
    variants.set(variant, counts);
  }
  const variantPerformance = [...variants.entries()]
    .map(([variant, counts]) => ({
      variant,
      ...counts,
      completionRate: counts.started > 0 ? Math.round((counts.completed / counts.started) * 100) : 0,
      clickThroughRate: counts.completed > 0 ? Math.round((counts.clicks / counts.completed) * 100) : 0,
    }))
    .sort((a, b) => b.started - a.started);

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
      abandoned: totalAbandoned,
      completionRate,
    },
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
router.get("/metrics/ai-insights", verifyToken, adminQuizScope, asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const quizId = getQuiz(res).id;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  if (Number.isNaN(since.getTime())) {
    res.status(400).json({ error: "Date de début invalide" });
    return;
  }

  const [started, completed, abandoned, ctaClicks, feedbackStats, topProducts, stepViews, stepAnswers] = await Promise.all([
    prisma.metric.count({ where: { tenantId, quizId, type: "quiz_start", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, quizId, type: "quiz_complete", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, quizId, type: "quiz_abandon", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, quizId, type: "buy_click", createdAt: { gte: since } } }),
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
      take: 3,
    }),
    prisma.metric.findMany({ where: { tenantId, quizId, type: "step_view", createdAt: { gte: since } }, select: { payload: true } }),
    prisma.metric.findMany({ where: { tenantId, quizId, type: "step_answer", createdAt: { gte: since } }, select: { payload: true } }),
  ]);

  type FeedbackRow = { feedback: string | null; _count: number };
  type TopProductRow = { resultProductId: string | null; _count: number };
  type MetricPayloadRow = { payload: unknown };

  const positive = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "positive")?._count ?? 0;
  const negative = (feedbackStats as FeedbackRow[]).find((f) => f.feedback === "negative")?._count ?? 0;
  const completionRate = started > 0 ? Math.round((completed / started) * 100) : 0;
  const ctaRate = completed > 0 ? Math.round((ctaClicks / completed) * 100) : 0;

  const viewsByStep = new Map<string, number>();
  const answersByStep = new Map<string, number>();
  for (const row of stepViews as MetricPayloadRow[]) {
    const payload = row.payload as Record<string, unknown>;
    const step = String(payload.step ?? payload.questionId ?? "unknown");
    viewsByStep.set(step, (viewsByStep.get(step) ?? 0) + 1);
  }
  for (const row of stepAnswers as MetricPayloadRow[]) {
    const payload = row.payload as Record<string, unknown>;
    const step = String(payload.step ?? payload.questionId ?? "unknown");
    answersByStep.set(step, (answersByStep.get(step) ?? 0) + 1);
  }

  const stepDropOff = [...new Set<string>([...viewsByStep.keys(), ...answersByStep.keys()])]
    .map((step) => {
      const views = viewsByStep.get(step) ?? 0;
      const answers = answersByStep.get(step) ?? 0;
      const dropOffRate = views > 0 ? Math.round(((views - answers) / views) * 100) : 0;
      return { step, dropOffRate, views };
    })
    .filter((s) => s.views > 0)
    .sort((a, b) => b.dropOffRate - a.dropOffRate)
    .slice(0, 3);

  const productIds = (topProducts as TopProductRow[]).map((p) => p.resultProductId).filter(Boolean) as string[];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

  const snapshot: MetricsSnapshot = {
    started,
    completed,
    abandoned,
    completionRate,
    ctaClicks,
    ctaRate,
    feedbackPositive: positive,
    feedbackNegative: negative,
    topProducts: (topProducts as TopProductRow[]).map((p) => ({
      name: productMap[p.resultProductId ?? ""] ?? "Inconnu",
      count: p._count,
    })),
    topDropOffSteps: stepDropOff,
  };

  const aiInsights = await generateOpenAIInsights(snapshot, getQuiz(res).industry);
  if (aiInsights && aiInsights.length > 0) {
    res.json({ source: "openai", generatedAt: new Date(), insights: aiInsights });
    return;
  }

  res.json({ source: "fallback", generatedAt: new Date(), insights: localInsightsFromSnapshot(snapshot) });
}));

export default router;
