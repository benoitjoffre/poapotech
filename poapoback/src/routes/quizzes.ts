import { Router } from "express";
import type { QuizAxis, QuizInput } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import {
  asyncRoute,
  createQuiz,
  ensureDefaultQuiz,
  quizInclude,
  QuizError,
  resolveQuiz,
} from "../services/quizzes";
import { resolveCatalog, validateCatalogProducts } from "../services/catalogs";
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

  if (body.catalogId !== undefined && (typeof body.catalogId !== "string" || !body.catalogId)) {
    throw new QuizError(400, "catalogId invalide");
  }

  if (
    body.productIds !== undefined &&
    (!Array.isArray(body.productIds) ||
      body.productIds.some((id) => typeof id !== "string" || !id))
  ) {
    throw new QuizError(400, "productIds doit être une liste d'identifiants");
  }
}

router.get(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = req.tenant!.tenantId;
    const catalogId = req.query.catalogId;
    if (catalogId !== undefined && (typeof catalogId !== "string" || !catalogId)) {
      throw new QuizError(400, "catalogId invalide");
    }

    await ensureDefaultQuiz(tenantId);

    const quizzes = await prisma.quiz.findMany({
      where: { tenantId, ...(catalogId && { catalogId }) },
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

    await ensureDefaultQuiz(tenantId);

    const catalog = await resolveCatalog(tenantId, body.catalogId);
    const productIds = await validateCatalogProducts(tenantId, catalog.id, body.productIds);

    const quiz = await createQuiz(tenantId, {
      name: body.name!,
      catalogId: catalog.id,
      industry: body.industry,
      axes: body.axes,
      quizTitle: body.quizTitle,
      ctaText: body.ctaText,
      active: body.active,
      useAllProducts: body.useAllProducts,
      productIds,
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
    const catalogId = body.catalogId === undefined ? quiz.catalogId : (await resolveCatalog(tenantId, body.catalogId)).id;
    const catalogChanged = catalogId !== quiz.catalogId;
    if (catalogChanged && body.productIds === undefined && quiz.products.length > 0) {
      throw new QuizError(
        409,
        "Ce quiz a une sélection de produits de son catalogue actuel : fournissez une nouvelle sélection (éventuellement vide) pour changer de catalogue",
      );
    }
    const productIds = await validateCatalogProducts(tenantId, catalogId, body.productIds);

    const updatedQuiz = await prisma.$transaction(async (tx) => {
      // La sélection est remplacée avant le changement de catalogue : les clés composites
      // de QuizProduct refuseraient sinon des produits de l'ancien catalogue.
      if (productIds !== undefined) await tx.quizProduct.deleteMany({ where: { quizId: quiz.id } });

      const updated = await tx.quiz.update({
        where: { id: quiz.id },
        data: {
          ...(catalogChanged && { catalogId }),
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.industry !== undefined && { industry: body.industry.trim() }),
          ...(body.axes !== undefined && { axes: body.axes as unknown as Prisma.InputJsonValue }),
          ...(body.quizTitle !== undefined && { quizTitle: body.quizTitle.trim() }),
          ...(body.ctaText !== undefined && { ctaText: body.ctaText.trim() }),
          ...(body.active !== undefined && { active: body.active }),
          ...(body.useAllProducts !== undefined && { useAllProducts: body.useAllProducts }),
          ...(productIds !== undefined && {
            products: { create: productIds.map((productId) => ({ productId })) },
          }),
        },
        include: quizInclude,
      });

      if (quiz.isDefault) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            industry: body.industry?.trim(),
            quizTitle: body.quizTitle?.trim(),
            ctaText: body.ctaText?.trim(),
          },
        });
      }
      return updated;
    });

    res.json(updatedQuiz);
  }),
);

export default router;
