import { Router } from "express";
import type { ProductIndustry, QuizInput } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import { asyncRoute, ensureDefaultQuiz, quizInclude, quizDefaults, QuizError, resolveQuiz } from "../services/quizzes";

const router = Router();
router.use(verifyToken);
const industries: ProductIndustry[] = ["perfume", "coffee", "fashion", "food", "custom"];

function validateInput(raw: unknown, creating: boolean): asserts raw is QuizInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, "Configuration de quiz invalide");
  const body = raw as Record<string, unknown>;
  for (const key of ["name", "quizTitle", "ctaText"]) {
    if ((creating && key === "name") || body[key] !== undefined) {
      if (typeof body[key] !== "string" || !body[key].trim()) throw new QuizError(400, `Le champ ${key} est requis`);
    }
  }
  if (body.industry !== undefined && !industries.includes(body.industry as ProductIndustry)) throw new QuizError(400, "Secteur invalide");
  for (const key of ["active", "useAllProducts"]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") throw new QuizError(400, `Le champ ${key} doit être un booléen`);
  }
  if (body.productIds !== undefined && (!Array.isArray(body.productIds) || body.productIds.some((id) => typeof id !== "string" || !id))) {
    throw new QuizError(400, "productIds doit être une liste d'identifiants");
  }
}

async function validateProducts(tenantId: string, productIds: string[] | undefined) {
  if (productIds === undefined) return undefined;
  const ids = [...new Set(productIds)];
  const owned = await prisma.product.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  if (owned.length !== ids.length) throw new QuizError(400, "Certains produits n'appartiennent pas à votre catalogue");
  return ids;
}

router.get("/", asyncRoute(async (req: AuthRequest, res) => {
  await ensureDefaultQuiz(req.tenant!.tenantId);
  res.json(await prisma.quiz.findMany({
    where: { tenantId: req.tenant!.tenantId }, include: quizInclude,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  }));
}));

router.post("/", asyncRoute(async (req: AuthRequest, res) => {
  validateInput(req.body, true);
  const body = req.body;
  const tenantId = req.tenant!.tenantId;
  const productIds = await validateProducts(tenantId, body.productIds);
  await ensureDefaultQuiz(tenantId);
  const industry = body.industry ?? "perfume";
  const defaults = quizDefaults(industry);
  const quiz = await prisma.quiz.create({
    data: {
      tenantId, name: body.name!.trim(), industry, quizTitle: body.quizTitle?.trim() ?? defaults.quizTitle,
      ctaText: body.ctaText?.trim() ?? defaults.ctaText, active: body.active ?? true,
      useAllProducts: body.useAllProducts ?? true,
      products: { create: (productIds ?? []).map((productId) => ({ productId })) },
    },
    include: quizInclude,
  });
  res.status(201).json(quiz);
}));

router.get("/:id", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await resolveQuiz(req.tenant!.tenantId, req.params.id));
}));

router.put("/:id", asyncRoute(async (req: AuthRequest, res) => {
  validateInput(req.body, false);
  const body = req.body;
  const tenantId = req.tenant!.tenantId;
  const quiz = await resolveQuiz(tenantId, req.params.id);
  const productIds = await validateProducts(tenantId, body.productIds);
  const update = prisma.quiz.update({
    where: { id: quiz.id },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.industry !== undefined && { industry: body.industry }),
      ...(body.quizTitle !== undefined && { quizTitle: body.quizTitle.trim() }),
      ...(body.ctaText !== undefined && { ctaText: body.ctaText.trim() }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.useAllProducts !== undefined && { useAllProducts: body.useAllProducts }),
      ...(productIds !== undefined && { products: { deleteMany: {}, create: productIds.map((productId) => ({ productId })) } }),
    },
    include: quizInclude,
  });
  const updated = quiz.isDefault ? (await prisma.$transaction([
    update,
    prisma.tenant.update({
      where: { id: tenantId },
      data: { industry: body.industry, quizTitle: body.quizTitle?.trim(), ctaText: body.ctaText?.trim() },
    }),
  ]))[0] : await update;
  res.json(updated);
}));

export default router;
