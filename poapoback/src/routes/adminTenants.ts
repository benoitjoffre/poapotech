import { Router, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { verifySuperAdmin, AuthRequest } from "../middleware/auth";
import type { TenantAdminCreateInput, TenantAdminUpdateInput } from "@poapo/types";

const router = Router();

router.use(verifySuperAdmin);

// GET /api/admin/tenants?page=1&pageSize=20&search=
router.get("/", async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const search = String(req.query.search ?? "").trim();

  const where = search
    ? {
        OR: [{ email: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }],
      }
    : {};

  const [total, data] = await Promise.all([
    prisma.tenant.count({ where }),
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        quizTitle: true,
        ctaText: true,
        primaryColor: true,
      },
    }),
  ]);

  res.json({ data, total, page, pageSize });
});

// POST /api/admin/tenants
router.post("/", async (req: AuthRequest, res: Response) => {
  const body = req.body as TenantAdminCreateInput;
  const email = body.email?.toLowerCase().trim();

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Email invalide" });
    return;
  }

  const existing = await prisma.tenant.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Un tenant existe déjà avec cet email" });
    return;
  }

  let passwordHash: string | undefined;
  if (body.password?.trim()) {
    if (body.password.length < 8) {
      res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
      return;
    }
    passwordHash = await bcrypt.hash(body.password, 12);
  }

  const created = await prisma.tenant.create({
    data: {
      email,
      name: body.name?.trim() || null,
      active: body.active ?? true,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      name: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      quizTitle: true,
      ctaText: true,
      primaryColor: true,
    },
  });

  res.status(201).json(created);
});

// PUT /api/admin/tenants/:id
router.put("/:id", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const body = req.body as TenantAdminUpdateInput;

  const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: "Tenant introuvable" });
    return;
  }

  const updated = await prisma.tenant.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.quizTitle !== undefined ? { quizTitle: body.quizTitle?.trim() || null } : {}),
      ...(body.ctaText !== undefined ? { ctaText: body.ctaText?.trim() || null } : {}),
      ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor?.trim() || null } : {}),
      ...(body.embedDomain !== undefined ? { embedDomain: body.embedDomain?.trim() || null } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      quizTitle: true,
      ctaText: true,
      primaryColor: true,
    },
  });

  res.json(updated);
});

// PUT /api/admin/tenants/:id/password
router.put("/:id/password", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { password } = req.body as { password?: string };

  if (!password || password.length < 8) {
    res.status(400).json({ error: "Mot de passe requis (8 caractères min)" });
    return;
  }

  const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: "Tenant introuvable" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.tenant.update({ where: { id }, data: { passwordHash } });
  res.json({ ok: true });
});

export default router;
