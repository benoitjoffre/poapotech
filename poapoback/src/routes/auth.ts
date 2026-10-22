import { Router, Request, Response } from "express";
import { sendMagicLink, verifyMagicToken, loginWithPassword, setPassword } from "../services/auth";
import { verifyToken, AuthRequest, SUPER_ADMIN_TENANT_ID } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import type { TenantBranding } from "@poapo/types";
import { ensureDefaultQuiz, asyncRoute } from "../services/quizzes";

const router = Router();
const MAX_INDUSTRY_LENGTH = 80;

// POST /api/auth/magic-link
router.post("/magic-link", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Email invalide" });
    return;
  }
  try {
    await sendMagicLink(email);
    res.json({ ok: true, message: "Lien de connexion envoyé" });
  } catch (err) {
    console.error("[auth] sendMagicLink error:", err);
    // Ne pas exposer le détail de l'erreur en production
    res.status(500).json({ error: "Impossible d'envoyer l'email" });
  }
});

// GET /api/auth/verify?token=
router.get("/verify", async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  try {
    const result = await verifyMagicToken(token);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token invalide";
    res.status(401).json({ error: message });
  }
});

// GET /api/auth/me
router.get("/me", verifyToken, asyncRoute(async (req: AuthRequest, res: Response) => {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
  const isSuperAdmin = !!req.tenant?.isSuperAdmin || (!!superAdminEmail && req.tenant?.email?.toLowerCase().trim() === superAdminEmail);

  if (isSuperAdmin && req.tenant!.tenantId === SUPER_ADMIN_TENANT_ID) {
    res.json({
      tenantId: SUPER_ADMIN_TENANT_ID,
      id: SUPER_ADMIN_TENANT_ID,
      email: req.tenant!.email,
      name: "Super Admin",
      active: true,
      isSuperAdmin: true,
    });
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenant!.tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      industry: true,
      primaryColor: true,
      logoUrl: true,
      quizTitle: true,
      ctaText: true,
      embedDomain: true,
      active: true,
      createdAt: true,
    },
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant introuvable" });
    return;
  }
  // Expose tenantId alias so AuthToken shape is satisfied client-side
  const quiz = await ensureDefaultQuiz(tenant.id);
  res.json({
    ...tenant,
    industry: quiz.industry,
    quizTitle: quiz.quizTitle,
    ctaText: quiz.ctaText,
    tenantId: tenant.id,
    ...(isSuperAdmin && { isSuperAdmin: true }),
  });
}));

// PUT /api/auth/me/branding
router.put("/me/branding", verifyToken, asyncRoute(async (req: AuthRequest, res: Response) => {
  const allowed: (keyof TenantBranding)[] = ["name", "industry", "primaryColor", "logoUrl", "quizTitle", "ctaText", "embedDomain"];
  const data: Partial<TenantBranding> = {};
  for (const key of allowed) {
    const val = (req.body as Record<string, unknown>)[key];
    if (val !== undefined) (data as Record<string, unknown>)[key] = val;
  }
  if (data.industry !== undefined) {
    if (typeof data.industry !== "string" || data.industry.trim().length > MAX_INDUSTRY_LENGTH) {
      res.status(400).json({ error: `L’activité doit être un texte de ${MAX_INDUSTRY_LENGTH} caractères maximum` });
      return;
    }
    data.industry = data.industry.trim();
  }

  const quiz = await ensureDefaultQuiz(req.tenant!.tenantId);
  await prisma.$transaction([
    prisma.tenant.update({ where: { id: req.tenant!.tenantId }, data }),
    prisma.quiz.update({
      where: { id: quiz.id },
      data: { industry: data.industry, quizTitle: data.quizTitle, ctaText: data.ctaText },
    }),
  ]);
  res.json({ ok: true });
}));

// POST /api/auth/login — email + mot de passe
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe requis" });
    return;
  }
  try {
    const result = await loginWithPassword(email, password);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur d'authentification";
    res.status(401).json({ error: message });
  }
});

// PUT /api/auth/me/password — définir / changer son mot de passe
router.put("/me/password", verifyToken, async (req: AuthRequest, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Mot de passe requis" });
    return;
  }
  try {
    await setPassword(req.tenant!.tenantId, password);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    res.status(400).json({ error: message });
  }
});

export default router;
