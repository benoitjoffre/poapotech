import type { Prisma } from "@prisma/client";
import type { QuizEditorDraft, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { resolveQuizTheme, visibleQuizQuestions } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { publishedContent, validateContent } from "./quizEditorDrafts";
import { QuizError, type ScopedQuiz } from "./quizzes";

export function inspectQuizStructure(draft: QuizEditorDraft): {
  errors: QuizPublicationIssue[]; warnings: QuizPublicationIssue[];
} {
  const errors: QuizPublicationIssue[] = [];
  const warnings: QuizPublicationIssue[] = [];
  const issue = (code: string, message: string, questionId?: string, answerId?: string): QuizPublicationIssue =>
    ({ code, message, section: "questions", ...(questionId && { questionId }), ...(answerId && { answerId }) });
  const owners = new Map(draft.questions.flatMap((q) => q.answers.map((a) => [a.id, { q, a }] as const)));
  const axisKeys = new Set(draft.config.axes.map((axis) => axis.key));
  for (const q of draft.questions) {
    if (!q.text.trim() || !["single", "multi", "scale"].includes(q.type)) {
      errors.push(issue("INVALID_QUESTION", "Question vide ou type invalide.", q.id));
    }
    if (q.abVariant !== null && !q.abVariant.trim()) errors.push(issue("INVALID_VARIANT", "Le libellé de variante est vide.", q.id));
    for (const a of q.answers) {
      if (!a.text.trim()) errors.push(issue("INVALID_ANSWER", "Le texte de la réponse est vide.", q.id, a.id));
      if (Object.entries(a.impacts).some(([key, value]) => !axisKeys.has(key) || !Number.isFinite(value) || Math.abs(value) > 1)) {
        errors.push(issue("INVALID_IMPACT", "Impact invalide ou associé à un axe inexistant.", q.id, a.id));
      }
      if (q.active && a.active && !Object.values(a.impacts).some((value) => value !== 0)) {
        warnings.push(issue("NO_IMPACT", "Cette réponse ne modifie aucun axe.", q.id, a.id));
      }
    }
    if (q.conditionAnswerId) {
      const parent = owners.get(q.conditionAnswerId);
      if (!parent || parent.q.id === q.id || parent.q.order >= q.order ||
          (q.active && (!parent.q.active || !parent.a.active))) {
        errors.push(issue("INCOHERENT_CONDITION", "La condition doit viser une réponse active d'une question précédente accessible.", q.id));
      }
      const visited = new Set([q.id]);
      let current = parent?.q;
      while (current) {
        if (visited.has(current.id)) {
          errors.push(issue("CYCLIC_CONDITION", "Cycle de conditions détecté.", q.id));
          break;
        }
        visited.add(current.id);
        current = current.conditionAnswerId ? owners.get(current.conditionAnswerId)?.q : undefined;
      }
    }
  }
  const active = draft.questions.filter((q) => q.active);
  const variants = [...new Set(active.map((q) => q.abVariant).filter((value): value is string => !!value))];
  let playable = false;
  for (const variant of variants.length ? variants : [null]) {
    const reachable = visibleQuizQuestions(active, new Set(active.flatMap((q) => q.answers.filter((a) => a.active).map((a) => a.id))), variant);
    const ids = new Set(reachable.map((q) => q.id));
    const applicable = active.filter((q) => !q.abVariant || q.abVariant === variant);
    for (const q of applicable) {
      if (!ids.has(q.id)) errors.push(issue("UNREACHABLE_CONDITION", `Question inaccessible${variant ? ` dans la variante ${variant}` : ""}.`, q.id));
      else if (!q.answers.some((a) => a.active)) errors.push(issue("NO_ACTIVE_ANSWER", "Question accessible sans réponse active.", q.id));
    }
    if (reachable.length && reachable.every((q) => q.answers.some((a) => a.active))) playable = true;
    if (!reachable.length) errors.push(issue("EMPTY_VARIANT", `Aucun parcours actif jouable${variant ? ` dans la variante ${variant}` : ""}.`));
  }
  if (!playable) errors.push(issue("NO_PLAYABLE_PATH", "Aucun parcours actif jouable."));
  if (!draft.config.name.trim() || !draft.config.quizTitle.trim() || !draft.config.ctaText.trim()) {
    errors.push({ code: "INVALID_CONFIG", message: "Le nom, le titre et le libellé produit sont requis.", section: "configuration" });
  }
  return { errors, warnings };
}

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const values = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The same diagnostic is mandatory for saved-draft publication and public-version activation. */
export async function diagnoseQuiz(
  quiz: ScopedQuiz, raw: unknown, db: Prisma.TransactionClient = prisma,
): Promise<{ diagnostic: QuizPublicationDiagnostic; draft: QuizEditorDraft | null }> {
  const campaigns = await db.campaign.findMany({
    where: { tenantId: quiz.tenantId, quizId: quiz.id }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });
  const diagnostic: QuizPublicationDiagnostic = {
    quizId: quiz.id, revision: 0, hasChanges: false, valid: false, errors: [], warnings: [], campaigns,
    summary: { name: quiz.name, catalogId: quiz.catalogId, catalogName: quiz.catalog.name, questions: 0, products: 0, active: quiz.active },
  };
  let draft: QuizEditorDraft;
  try {
    draft = await validateContent(quiz, raw, db);
  } catch (err) {
    if (!(err instanceof QuizError)) throw err;
    const message = err.message;
    const section = /thème|Couleur|Typographie|logo|bouton|Libellé/.test(message) ? "appearance"
      : /Catalogue|catalogue|produit|axe|Activité/.test(message) ? "configuration" : "questions";
    diagnostic.errors.push({ code: "INVALID_DOCUMENT", message, section });
    return { diagnostic, draft: null };
  }
  const structure = inspectQuizStructure(draft);
  diagnostic.errors.push(...structure.errors);
  diagnostic.warnings.push(...structure.warnings);
  const products = await db.product.findMany({
    where: { tenantId: quiz.tenantId, catalogId: draft.config.catalogId, active: true,
      ...(!draft.config.useAllProducts && { id: { in: draft.config.productIds } }) },
    select: { id: true, attributes: true, embedding: true },
  });
  const catalog = await db.catalog.findFirst({ where: { tenantId: quiz.tenantId, id: draft.config.catalogId } });
  diagnostic.summary = {
    name: draft.config.name, catalogId: draft.config.catalogId, catalogName: catalog!.name,
    questions: draft.questions.filter((q) => q.active).length, products: products.length, active: draft.config.active,
  };
  if (!products.length) diagnostic.errors.push({ code: "NO_PRODUCTS", message: "Aucun produit actif recommandable dans le catalogue et la sélection.", section: "configuration" });
  const warning = (code: string, message: string, section: QuizPublicationIssue["section"] = "configuration") =>
    diagnostic.warnings.push({ code, message, section });
  for (const axis of draft.config.axes) {
    const values = products.map((p) => {
      const attrs = p.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes) ? p.attributes : {};
      return attrs[axis.key];
    });
    if (values.some((v) => typeof v !== "number" || v < 0 || v > 1)) warning("MISSING_ATTRIBUTES", `Attribut d'axe « ${axis.label} » manquant ou invalide sur certains produits.`);
    const impacts = draft.questions.filter((q) => q.active).flatMap((q) => q.answers.filter((a) => a.active).map((a) => a.impacts[axis.key] ?? 0));
    if (new Set(values.filter((v) => typeof v === "number")).size < 2 || new Set(impacts).size < 2) {
      warning("WEAK_AXIS", `L'axe « ${axis.label} » est peu discriminant.`);
    }
  }
  if (!draft.config.axes.length) warning("NO_AXES", "Aucun axe : la discrimination du profil est limitée.");
  if (products.some((p) => !Array.isArray(p.embedding) || !p.embedding.length)) warning("MISSING_EMBEDDINGS", "Certains produits n'ont pas d'embedding ; leur score sémantique sera nul.");
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: quiz.tenantId }, select: { primaryColor: true, logoUrl: true } });
  const theme = resolveQuizTheme(tenant, draft.theme);
  if (contrast(theme.textColor, theme.backgroundColor) < 4.5 || contrast("#ffffff", theme.primaryColor) < 4.5) {
    warning("LOW_CONTRAST", "Contraste inférieur à 4,5:1 pour le texte ou le bouton principal. Vérifiez aussi les images et dégradés.", "appearance");
  }
  if (campaigns.length > 1) warning("SHARED_QUIZ", `Ce quiz est partagé par ${campaigns.length} campagnes.`, "publication");
  diagnostic.valid = !diagnostic.errors.length;
  return { diagnostic, draft };
}

export async function assertPublishedQuizValid(quiz: ScopedQuiz, db: Prisma.TransactionClient = prisma) {
  const { diagnostic } = await diagnoseQuiz(quiz, await publishedContent(quiz, db), db);
  if (!diagnostic.valid) throw new QuizError(422, `Activation refusée : ${diagnostic.errors.map((e) => e.message).join(" ")}`);
}
