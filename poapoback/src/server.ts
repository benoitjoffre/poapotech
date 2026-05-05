import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import embedRouter from "./routes/embed";
import quizRouter from "./routes/quiz";
import quizBuilderRouter from "./routes/quizBuilder";
import catalogRouter from "./routes/catalog";
import importRouter from "./routes/import";
import adminTenantsRouter from "./routes/adminTenants";

const app = express();

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(
  helmet({
    // Permettre l'intégration en iframe sur les domaines clients
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS — autoriser les origines configurées
const allowedOrigins = [process.env.FRONTEND_URL ?? "http://localhost:5173", process.env.ADMIN_URL ?? "http://localhost:5174"];
app.use(
  cors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (curl, Postman, server-side)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} non autorisée`));
    },
    credentials: true,
  }),
);

// Rate limiting global
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 200,
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
app.use("/api/catalog", catalogRouter);
app.use("/api/catalog/import", importRouter);
app.use("/api/admin/tenants", adminTenantsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Route introuvable" });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 5050);
app.listen(port, () => {
  console.log(`[poapoback] API listening on http://localhost:${port}`);
});

export default app;
