import { Router } from "express";
import type { QuizAxis, QuizInput } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import {
  asyncRoute,
  ensureDefaultQuiz,
  quizInclude,
  quizDefaults,
  QuizError,
  resolveQuiz,
} from "../services/quizzes";
import { AxisValidationError, validateAxes } from "../services/axes";

const router = Router();
const MAX_INDUSTRY_LENGTH = 80;

router.use(verifyToken);

function validateInput(raw: unknown, creating: boolean): asserts raw is Partial<QuizInput> & { axes?: QuizAxis[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new QuizError(400, "Configuration de quiz invalide");
  }

  const body = raw as Record<string, unknown>;
  const requiredFields = creating ? ["name"] : [];
  const textFields = ["name", "quizTitle", "ctaText"];

  for (const key of textFields) {
    if (requiredFields.includes(key) || body[key] !== undefined) {
      if (typeof body[key] !== "string" || !body[key].trim()) {
        throw new QuizError(400, `Le champ ${key} est requis`);
      }
    }
  }

  if (body.industry !== undefined && (typeof body.industry !== "string" || body.industry.trim().length > MAX_INDUSTRY_LENGTH)) {
    throw new QuizError(400, `L'activité doit être un texte de ${MAX_INDUSTRY_LENGTH} caractères maximum`);
  }

  if (body.axes !== undefined) {
    try {
      body.axes = validateAxes(body.axes);
    } catch (err) {
      if (err instanceof AxisValidationError) throw new QuizError(400, err.message);
      throw err;
    }
  }

  for (const key of ["active", "useAllProducts"]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") {
      throw new QuizError(400, `Le champ ${key} doit être un booléen`);
    }
  }

  if (
    body.productIds !== undefined &&
    (!Array.isArray(body.productIds) ||
      body.productIds.some((id) => typeof id !== "string" || !id))
  ) {
    throw new QuizError(400, "productIds doit être une liste d'identifiants");
  }
}

async function validateProducts(tenantId: string, productIds: string[] | undefined) {
  if (productIds === undefined) return undefined;

  const uniqueProductIds = [...new Set(productIds)];
  const tenantProducts = await prisma.product.findMany({
    where: { tenantId, id: { in: uniqueProductIds } },
    select: { id: true },
  });

  if (tenantProducts.length !== uniqueProductIds.length) {
    throw new QuizError(400, "Certains produits n'appartiennent pas à votre catalogue");
  }

  return uniqueProductIds;
}

router.get(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = req.tenant!.tenantId;

    await ensureDefaultQuiz(tenantId);

    const quizzes = await prisma.quiz.findMany({
      where: { tenantId },
      include: quizInclude,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    res.json(quizzes);
  }),
);

router.post(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    validateInput(req.body, true);

    const body = req.body;
    const tenantId = req.tenant!.tenantId;
    const productIds = await validateProducts(tenantId, body.productIds);

    await ensureDefaultQuiz(tenantId);

    const industry = body.industry?.trim() ?? "";
    const defaults = quizDefaults();
    const quiz = await prisma.quiz.create({
      data: {
        tenantId,
        name: body.name!.trim(),
        industry,
        axes: (body.axes ?? []) as unknown as Prisma.InputJsonValue,
        quizTitle: body.quizTitle?.trim() ?? defaults.quizTitle,
        ctaText: body.ctaText?.trim() ?? defaults.ctaText,
        active: body.active ?? true,
        useAllProducts: body.useAllProducts ?? true,
        products: {
          create: (productIds ?? []).map((productId) => ({ productId })),
        },
      },
      include: quizInclude,
    });

    res.status(201).json(quiz);
  }),
);

router.get(
  "/:id",
  asyncRoute(async (req: AuthRequest, res) => {
    const quiz = await resolveQuiz(req.tenant!.tenantId, req.params.id);
    res.json(quiz);
  }),
);

router.put(
  "/:id",
  asyncRoute(async (req: AuthRequest, res) => {
    validateInput(req.body, false);

    const body = req.body;
    const tenantId = req.tenant!.tenantId;
    const quiz = await resolveQuiz(tenantId, req.params.id);
    const productIds = await validateProducts(tenantId, body.productIds);

    const updateQuiz = prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.industry !== undefined && { industry: body.industry.trim() }),
        ...(body.axes !== undefined && { axes: body.axes as unknown as Prisma.InputJsonValue }),
        ...(body.quizTitle !== undefined && { quizTitle: body.quizTitle.trim() }),
        ...(body.ctaText !== undefined && { ctaText: body.ctaText.trim() }),
        ...(body.active !== undefined && { active: body.active }),
        ...(body.useAllProducts !== undefined && { useAllProducts: body.useAllProducts }),
        ...(productIds !== undefined && {
          products: {
            deleteMany: {},
            create: productIds.map((productId) => ({ productId })),
          },
        }),
      },
      include: quizInclude,
    });

    if (!quiz.isDefault) {
      res.json(await updateQuiz);
      return;
    }

    const [updatedQuiz] = await prisma.$transaction([
      updateQuiz,
      prisma.tenant.update({
        where: { id: tenantId },
        data: {
          industry: body.industry?.trim(),
          quizTitle: body.quizTitle?.trim(),
          ctaText: body.ctaText?.trim(),
        },
      }),
    ]);

    res.json(updatedQuiz);
  }),
);

export default router;
