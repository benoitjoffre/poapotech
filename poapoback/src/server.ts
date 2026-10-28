import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import embedRouter from "./routes/embed";
import quizRouter from "./routes/quiz";
import quizBuilderRouter from "./routes/quizBuilder";
import catalogsRouter from "./routes/catalogs";
import catalogRouter from "./routes/catalog";
import importRouter from "./routes/import";
import adminTenantsRouter from "./routes/adminTenants";
import subscriptionRouter from "./routes/subscription";
import { startRetentionJob } from "./services/recommendationRetention";
import metricsRouter from "./routes/metrics";
import resultsRouter from "./routes/results";
import quizzesRouter from "./routes/quizzes";
import campaignsRouter from "./routes/campaigns";
import dashboardRouter from "./routes/dashboard";
import experiencesRouter from "./routes/experiences";
import expressQuizRouter from "./routes/expressQuiz";
import { quizErrorHandler } from "./services/quizzes";
import { corsPolicy } from "./services/cors";
import { checkReadiness } from "./services/readiness";
import { startEmbeddingWorker } from "./services/embeddings";
import { globalRateLimitMax } from "./rateLimitConfig";
import { assertProductionEnv } from "./services/productionEnv";

assertProductionEnv();

const app = express();
// Derrière le proxy Render : IP réelle du visiteur pour le rate limiting.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(
  helmet({
    // Permettre l'intégration en iframe sur les domaines clients
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS — widget public ouvert à toute origine, administration limitée à FRONTEND_URL / ADMIN_URL
app.use(corsPolicy());

// Liveness : le processus répond (utilisé par Render pour redémarrer, sans dépendance externe).
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// Readiness : 503 seulement si PostgreSQL est inaccessible. Python arrêté = "degraded" (200) :
// l'administration reste disponible, seuls les parcours qui en dépendent échouent explicitement.
app.get("/ready", async (_req, res) => {
  const state = await checkReadiness();
  res.status(state.ready ? 200 : 503).json({ status: !state.ready ? "unavailable" : state.ai === "down" ? "degraded" : "ok", ...state });
});

// Rate limiting global
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: globalRateLimitMax(),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, réessayez dans 15 minutes" },
  }),
);

// Rate limiting strict pour les endpoints d'auth
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: "Trop de tentatives, réessayez dans 5 minutes" },
});

app.use(express.json({ limit: "10mb" }));

// ─── Routes ────────────────────────────────────────────────────────────────────
// Limiter uniquement les routes sensibles pour eviter de bloquer /api/auth/me
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/magic-link", authLimiter);
app.use("/api/auth", authRouter);
app.use("/api/embed", embedRouter);
app.use("/api/quiz", quizRouter);
app.use("/api/quiz/builder", quizBuilderRouter);
app.use("/api/quizzes", quizzesRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/experiences", experiencesRouter);
app.use("/api/express-quiz", expressQuizRouter);
app.use("/api/catalogs", catalogsRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/catalog/import", importRouter);
app.use("/api/admin/tenants", adminTenantsRouter);
app.use("/api/subscription", subscriptionRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/results", resultsRouter);

app.use(quizErrorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Route introuvable" });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 5050);
app.listen(port, () => {
  console.log(`[poapoback] API listening on http://localhost:${port}`);
  startEmbeddingWorker();
  startRetentionJob();
});

export default app;
