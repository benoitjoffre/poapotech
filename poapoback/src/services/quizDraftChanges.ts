import type { Prisma } from "@prisma/client";
import type { QuizEditorDraft } from "@poapo/types";
import { quizInclude } from "./quizzes";

/**
 * Forme canonique d'un contenu d'éditeur, pour décider s'il diffère de la version publiée.
 * Ne retient que les données métier (config, critères, produits, apparence, questions, réponses) :
 * - clés triées, `null`/absent équivalents (champs facultatifs), thème vide = pas de thème ;
 * - questions et réponses triées par (ordre, identifiant), comme à la publication ; produits triés (ensemble).
 * Aucune métadonnée technique (révision, date) n'entre dans la comparaison.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function canonicalDraft(draft: QuizEditorDraft): string {
  const theme = canonical(draft.theme) as Record<string, unknown> | undefined;
  return JSON.stringify(canonical({
    schemaVersion: draft.schemaVersion,
    ...(theme && Object.keys(theme).length > 0 && { theme }),
    config: { ...draft.config, productIds: [...draft.config.productIds].sort() },
    questions: [...draft.questions].sort(byOrder).map((q) => ({ ...q, answers: [...q.answers].sort(byOrder) })),
  }));
}

/**
 * Le brouillon contient-il des changements non publiés ? En cas de doute (contenu illisible, forme inattendue) : oui.
 * Un brouillon n'est donc jamais masqué à tort ; seul un brouillon strictement équivalent à la version publiée est écarté.
 */
export function differsFromPublished(content: unknown, published: QuizEditorDraft): boolean {
  try {
    return canonicalDraft(content as QuizEditorDraft) !== canonicalDraft(published);
  } catch {
    return true;
  }
}

/**
 * Brouillons réellement différents de la version publiée, par quiz (date d'enregistrement du brouillon).
 * Nombre constant de requêtes, quel que soit le nombre de quiz.
 */
export async function unpublishedDrafts(
  db: Prisma.TransactionClient, tenantId: string,
  toPublished: (quiz: Awaited<ReturnType<typeof loadQuizzes>>[number], questions: Awaited<ReturnType<typeof loadQuestions>>) => QuizEditorDraft,
): Promise<Map<string, Date>> {
  const rows = await db.$queryRaw<{ quizId: string; updatedAt: Date; content: unknown }[]>`
    SELECT "quizId", "updatedAt", content FROM "QuizEditorDraft"
    WHERE "tenantId" = ${tenantId} AND content IS NOT NULL AND content <> 'null'::jsonb`;
  const result = new Map<string, Date>();
  if (!rows.length) return result;
  const ids = rows.map((row) => row.quizId);
  const [quizzes, questions] = await Promise.all([loadQuizzes(db, tenantId, ids), loadQuestions(db, tenantId, ids)]);
  const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  for (const row of rows) {
    const quiz = quizById.get(row.quizId);
    const own = questions.filter((question) => question.quizId === row.quizId);
    if (!quiz || differsFromPublished(row.content, toPublished(quiz, own))) result.set(row.quizId, row.updatedAt);
  }
  return result;
}

const loadQuizzes = (db: Prisma.TransactionClient, tenantId: string, ids: string[]) =>
  db.quiz.findMany({ where: { tenantId, id: { in: ids } }, include: quizInclude });
const loadQuestions = (db: Prisma.TransactionClient, tenantId: string, ids: string[]) =>
  db.question.findMany({
    where: { tenantId, quizId: { in: ids } },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    include: { answers: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
  });
