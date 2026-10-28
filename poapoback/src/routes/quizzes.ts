import { Router } from "express";
import type { QuizAxis, QuizInput } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { verifyToken } from "../middleware/auth";
import { assertResourceQuota, withTenantLock } from "../services/entitlements";
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
import { discardQuizEditorDraft, readQuizEditorDraft, saveQuizEditorDraft } from "../services/quizEditorDrafts";
import { prepareQuizPreview, recommendQuizPreview } from "../services/quizPreview";
import { checkQuizPublication, lockQuiz, publishQuizDraft } from "../services/quizPublication";
import { assertPublishedQuizValid } from "../services/quizPublicationDiagnostic";

const router = Router();
const MAX_INDUSTRY_LENGTH = 80;

router.use(verifyToken);

router.post("/:id/publication/check", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await checkQuizPublication(req.tenant!.tenantId, req.params.id, req.body?.revision));
}));

router.post("/:id/publication/publish", asyncRoute(async (req: AuthRequest, res) => {
  if (req.body?.confirm !== true) throw new QuizError(400, "Confirmation explicite de publication requise");
  res.json(await publishQuizDraft(req.tenant!.tenantId, req.params.id, req.body?.revision, req.body?.confirmedCampaignIds));
}));

router.post("/:id/preview", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await prepareQuizPreview(req.tenant!.tenantId, req.params.id, req.body?.draft));
}));

router.post("/:id/preview/recommendations", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await recommendQuizPreview(req.tenant!.tenantId, req.params.id, req.body?.draft, req.body?.answers, req.body?.abVariant));
}));

router.get("/:id/draft", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await readQuizEditorDraft(req.tenant!.tenantId, req.params.id));
}));

router.put("/:id/draft", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await saveQuizEditorDraft(req.tenant!.tenantId, req.params.id, req.body?.revision, req.body?.draft));
}));

router.delete("/:id/draft", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await discardQuizEditorDraft(req.tenant!.tenantId, req.params.id, req.body?.revision));
}));

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
    if (body.active === true) throw new QuizError(422, "Un nouveau quiz vide doit être créé inactif, puis complété et publié avant activation");

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
      // An empty new quiz cannot be activated before its content is published and checked.
      active: false,
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
    if (Object.keys(req.body ?? {}).some((key) => key !== "active")) {
      await resolveQuiz(req.tenant!.tenantId, req.params.id);
      throw new QuizError(409, "Le contenu du quiz se modifie uniquement via son brouillon avec une révision");
    }
    validateInput(req.body, false);

    const body = req.body;
    const tenantId = req.tenant!.tenantId;
    // Verrou boutique avant verrou quiz (ordre constant) : deux activations concurrentes ne dépassent pas le quota.
    const updatedQuiz = await withTenantLock(tenantId, async (db) => {
      const quiz = await lockQuiz(db, tenantId, req.params.id);
      if (body.active === true && !quiz.active) await assertResourceQuota(db, tenantId, "publishedExperiences");
      if (body.active === true) await assertPublishedQuizValid(quiz, db);
      return db.quiz.update({
        where: { id: quiz.id },
        data: { ...(body.active !== undefined && { active: body.active }) },
        include: quizInclude,
      });
    });

    res.json(updatedQuiz);
  }),
);

export default router;
