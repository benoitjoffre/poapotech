import type { ExperienceListItem } from "@poapo/types";

export interface PublicAvailability {
  accessible: boolean;
  label: string;
  reason: string | null;
}

/** Même règle que l'API publique : boutique active ET quiz actif. */
export function publicAvailability({ shopActive, quizActive }: { shopActive: boolean; quizActive: boolean }): PublicAvailability {
  if (!shopActive) return { accessible: false, label: "Désactivée pour le public", reason: "Boutique désactivée" };
  if (!quizActive) return { accessible: false, label: "Désactivée pour le public", reason: "Quiz désactivé" };
  return { accessible: true, label: "Accessible au public", reason: null };
}

export type AvailabilityFilter = "all" | "accessible" | "inactive";
export type DraftFilter = "all" | "with" | "without";
export type ExperienceSort = "recent" | "name";

export interface ExperienceFilters {
  query: string;
  availability: AvailabilityFilter;
  draft: DraftFilter;
  catalogId: string;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function filterExperiences(items: ExperienceListItem[], filters: ExperienceFilters): ExperienceListItem[] {
  const query = normalize(filters.query);
  return items.filter((item) =>
    (!filters.catalogId || item.catalog.id === filters.catalogId) &&
    (filters.availability === "all" || item.accessible === (filters.availability === "accessible")) &&
    (filters.draft === "all" || item.hasDraft === (filters.draft === "with")) &&
    (!query || normalize(item.name).includes(query)));
}

export function sortExperiences(items: ExperienceListItem[], sort: ExperienceSort): ExperienceListItem[] {
  const byName = (a: ExperienceListItem, b: ExperienceListItem) =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id);
  return [...items].sort(sort === "name" ? byName
    : (a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt) || byName(a, b));
}

export function questionCountLabel(count: number): string {
  return count === 0 ? "Aucune question active" : `${count} question${count > 1 ? "s" : ""}`;
}

export function totalsOf(items: ExperienceListItem[]) {
  return items.reduce((total, item) => ({
    accessible: total.accessible + Number(item.accessible),
    started: total.started + (item.stats?.started ?? 0),
    completed: total.completed + (item.stats?.completed ?? 0),
  }), { accessible: 0, started: 0, completed: 0 });
}

/**
 * Statut affiché dans « Mes quiz », déduit des seules données existantes (aucun statut persisté).
 * - « publié » = la version en ligne contient des questions actives (le backend refuse d'activer ou de publier sans parcours jouable) ;
 * - `active` = état du quiz seul (quota « Quiz en ligne »), `accessible` = quiz actif ET boutique active ;
 * - `hasDraft` = brouillon enregistré, jamais déduit de la version publique.
 * Un seul statut principal ; « Modifications en cours » est une mention secondaire d'un quiz déjà publié.
 */
export type QuizStatusId = "online" | "to-finish" | "offline";

export interface QuizStatus {
  id: QuizStatusId;
  label: string;
  /** Mention discrète : la version publique reste inchangée tant que le brouillon n'est pas publié. */
  note: string | null;
  /** Précision sur la cause lorsqu'un quiz publié est fermé au public. */
  reason: string | null;
  /** Une version publique existe (questions actives en ligne). */
  published: boolean;
}

type StatusInput = Pick<ExperienceListItem, "accessible" | "active" | "hasDraft" | "questionCount">;

export function quizStatus(item: StatusInput, shopActive = true): QuizStatus {
  const published = item.questionCount > 0;
  const note = published && item.hasDraft ? "Modifications en cours" : null;
  if (item.accessible) return { id: "online", label: "En ligne", note, reason: null, published };
  // Jamais publié : rien n'est visible des visiteurs, que le quiz soit vide ou n'ait qu'un brouillon.
  if (!published) return { id: "to-finish", label: "À terminer", note: null, reason: null, published };
  // Publié mais fermé : la cause est la boutique (même si le quiz est actif) ou le quiz lui-même.
  const reason = !shopActive ? "Boutique désactivée" : !item.active ? "Quiz désactivé" : null;
  return { id: "offline", label: "Hors ligne", note, reason, published };
}

export type QuizFilter = "all" | "online" | "to-finish";

/** « À terminer » regroupe tout quiz non en ligne (à finir, ou publié mais fermé) : l'action attendue est la même, rouvrir l'éditeur. */
export function matchesQuizFilter(status: QuizStatus, filter: QuizFilter): boolean {
  return filter === "all" || (filter === "online" ? status.id === "online" : status.id !== "online");
}

/** Action principale d'une carte, selon l'état réel. */
export function primaryActionLabel(item: Pick<ExperienceListItem, "hasDraft">, status: QuizStatus): string {
  if (status.id === "online") return "Modifier";
  if (item.hasDraft) return "Reprendre le brouillon";
  return status.published ? "Modifier" : "Continuer";
}
