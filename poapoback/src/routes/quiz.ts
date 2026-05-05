import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import type { QuizSubmitPayload, MetricType } from "@poapo/types";

const router = Router();

type MetricsSnapshot = {
  started: number;
  completed: number;
  abandoned: number;
  completionRate: number;
  ctaClicks: number;
  ctaRate: number;
  feedbackPositive: number;
  feedbackNegative: number;
  topProducts: { name: string; count: number }[];
  topDropOffSteps: { step: string; dropOffRate: number; views: number }[];
};

function localInsightsFromSnapshot(snapshot: MetricsSnapshot) {
  const insights: { title: string; insight: string; priority: "high" | "medium" | "low"; actions: string[] }[] = [];

  if (snapshot.completionRate < 35) {
    insights.push({
      title: "Complétion faible",
      insight: `Le taux de complétion est de ${snapshot.completionRate}%, ce qui indique un fort abandon en cours de quiz.`,
      priority: "high",
      actions: [
        "Réduire le nombre de questions ou regrouper des étapes",
        "Raccourcir les intitulés de questions",
        "Ajouter une estimation de temps plus visible",
      ],
    });
  }

  if (snapshot.ctaRate < 20 && snapshot.completed > 10) {
    insights.push({
      title: "Conversion CTA sous-exploitée",
      insight: `Le CTR post-résultat est de ${snapshot.ctaRate}% malgré ${snapshot.completed} quiz complétés.`,
      priority: "high",
      actions: [
        "Tester un CTA plus orienté bénéfice",
        "Mettre un visuel produit plus grand dans le résultat",
        "Ajouter une preuve sociale sous le CTA",
      ],
    });
  }

  if (snapshot.feedbackNegative > snapshot.feedbackPositive) {
    insights.push({
      title: "Satisfaction en baisse",
      insight: `Les feedbacks négatifs (${snapshot.feedbackNegative}) dépassent les positifs (${snapshot.feedbackPositive}).`,
      priority: "medium",
      actions: [
        "Analyser les produits les plus souvent recommandés",
        "Ajuster les impacts de scoring des réponses",
        "Tester une variante de quiz plus guidée",
      ],
    });
  }

  if (snapshot.topDropOffSteps.length > 0) {
    const step = snapshot.topDropOffSteps[0];
    insights.push({
      title: "Étape à fort drop-off",
      insight: `L'étape ${step.step} a un drop-off de ${step.dropOffRate}% sur ${step.views} vues.`,
      priority: "medium",
      actions: ["Simplifier les options de cette étape", "Vérifier la lisibilité mobile", "Tester une formulation plus directe"],
    });
  }

  if (insights.length === 0) {
    insights.push({
      title: "Traction saine",
      insight: "Les indicateurs clés sont équilibrés, aucune alerte critique détectée.",
      priority: "low",
      actions: ["Lancer un A/B test sur le texte CTA", "Suivre l'évolution hebdomadaire des steps", "Créer un segment nouveaux vs récurrents"],
    });
  }

  return insights.slice(0, 3);
}

async function generateOpenAIInsights(snapshot: MetricsSnapshot) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "Tu es analyste CRO senior pour un quiz e-commerce parfum.",
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
router.get("/questions", async (req: Request, res: Response) => {
  const { clientId } = req.query as { clientId?: string };
  if (!clientId) {
    res.status(400).json({ error: "clientId manquant" });
    return;
  }
  const questions = await prisma.question.findMany({
    where: { tenantId: clientId, active: true },
    orderBy: { order: "asc" },
    include: {
      answers: {
        where: { active: true },
        orderBy: { order: "asc" },
      },
    },
  });
  res.json(questions);
});

// POST /api/quiz/submit
router.post("/submit", async (req: Request, res: Response) => {
  const body = req.body as QuizSubmitPayload;
  const { clientId, gender, mood, answers, decisionTime, abVariant } = body as QuizSubmitPayload & { abVariant?: string };

  if (!clientId) {
    res.status(400).json({ error: "clientId manquant" });
    return;
  }

  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) {
    res.status(503).json({ error: "Service IA non disponible" });
    return;
  }

  try {
    // Construire le profil olfactif depuis les réponses
    const answerDocs = await prisma.answer.findMany({
      where: { id: { in: answers.map((a) => a.answerId) } },
    });

    let freshness = 0.5;
    let intensity = 0.5;
    let sweetness = 0.5;

    for (const ans of answerDocs) {
      const impacts = ans.impacts as { freshness: number; intensity: number; sweetness: number };
      freshness = Math.max(0, Math.min(1, freshness + (impacts.freshness ?? 0)));
      intensity = Math.max(0, Math.min(1, intensity + (impacts.intensity ?? 0)));
      sweetness = Math.max(0, Math.min(1, sweetness + (impacts.sweetness ?? 0)));
    }

    // Appel au service IA pour la recommandation
    const aiResponse = await fetch(`${aiUrl}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: clientId,
        profile: { freshness, intensity, sweetness },
        gender: gender ?? null,
        mood: mood ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const { productId, explanation, profileSummary } = (await aiResponse.json()) as {
      productId: string;
      explanation: string[];
      profileSummary: Record<string, unknown>;
    };

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        brand: true,
        description: true,
        price: true,
        priceTier: true,
        imageUrl: true,
        purchaseUrl: true,
        concentration: true,
        freshness: true,
        intensity: true,
        sweetness: true,
        olfactoryFamily: true,
        tags: true,
        topNotes: true,
        heartNotes: true,
        baseNotes: true,
        genderTarget: true,
      },
    });

    // Persister la session
    const session = await prisma.quizSession.create({
      data: {
        tenantId: clientId,
        gender: gender ?? null,
        mood: mood ?? null,
        answers: answers as unknown as object,
        resultProductId: productId,
        decisionTime: decisionTime ?? null,
        abVariant: abVariant ?? null,
        completedAt: new Date(),
      },
    });

    res.json({ sessionId: session.id, product, explanation, profileSummary });
  } catch (err) {
    console.error("[quiz] submit error:", err);
    res.status(500).json({ error: "Erreur lors du calcul de la recommandation" });
  }
});

// POST /api/quiz/track
router.post("/track", async (req: Request, res: Response) => {
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
      type: type as MetricType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: (payload ?? {}) as any,
    },
  });

  res.json({ ok: true });
});

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
router.get("/metrics", verifyToken, async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30j par défaut

  const [totalStarted, totalCompleted, totalAbandoned, totalBuyClicks, feedbackStats, topProducts, genderStats, stepViews, stepAnswers] =
    await Promise.all([
      prisma.metric.count({ where: { tenantId, type: "quiz_start", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, type: "quiz_complete", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, type: "quiz_abandon", createdAt: { gte: since } } }),
      prisma.metric.count({ where: { tenantId, type: "buy_click", createdAt: { gte: since } } }),
      prisma.quizSession.groupBy({
        by: ["feedback"],
        where: { tenantId, feedback: { not: null }, createdAt: { gte: since } },
        _count: true,
      }),
      prisma.quizSession.groupBy({
        by: ["resultProductId"],
        where: { tenantId, resultProductId: { not: null }, completedAt: { gte: since } },
        _count: true,
        orderBy: { _count: { resultProductId: "desc" } },
        take: 5,
      }),
      prisma.quizSession.groupBy({
        by: ["gender"],
        where: { tenantId, createdAt: { gte: since } },
        _count: true,
      }),
      prisma.metric.findMany({
        where: { tenantId, type: "step_view", createdAt: { gte: since } },
        select: { payload: true },
      }),
      prisma.metric.findMany({
        where: { tenantId, type: "step_answer", createdAt: { gte: since } },
        select: { payload: true },
      }),
    ]);

  const completionRate = totalStarted > 0 ? Math.round((totalCompleted / totalStarted) * 100) : 0;

  type FeedbackRow = { feedback: string | null; _count: number };
  type TopProductRow = { resultProductId: string | null; _count: number };
  type GenderRow = { gender: string | null; _count: number };

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
    genders: (genderStats as GenderRow[]).map((g) => ({ gender: g.gender ?? "unknown", count: g._count })),
  });
});

// GET /api/quiz/metrics/ai-insights
router.get("/metrics/ai-insights", verifyToken, async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [started, completed, abandoned, ctaClicks, feedbackStats, topProducts, stepViews, stepAnswers] = await Promise.all([
    prisma.metric.count({ where: { tenantId, type: "quiz_start", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, type: "quiz_complete", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, type: "quiz_abandon", createdAt: { gte: since } } }),
    prisma.metric.count({ where: { tenantId, type: "buy_click", createdAt: { gte: since } } }),
    prisma.quizSession.groupBy({
      by: ["feedback"],
      where: { tenantId, feedback: { not: null }, createdAt: { gte: since } },
      _count: true,
    }),
    prisma.quizSession.groupBy({
      by: ["resultProductId"],
      where: { tenantId, resultProductId: { not: null }, completedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { resultProductId: "desc" } },
      take: 3,
    }),
    prisma.metric.findMany({ where: { tenantId, type: "step_view", createdAt: { gte: since } }, select: { payload: true } }),
    prisma.metric.findMany({ where: { tenantId, type: "step_answer", createdAt: { gte: since } }, select: { payload: true } }),
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

  const aiInsights = await generateOpenAIInsights(snapshot);
  if (aiInsights && aiInsights.length > 0) {
    res.json({ source: "openai", generatedAt: new Date(), insights: aiInsights });
    return;
  }

  res.json({ source: "fallback", generatedAt: new Date(), insights: localInsightsFromSnapshot(snapshot) });
});

export default router;
