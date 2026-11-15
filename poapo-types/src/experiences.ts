import type { QuizOccasion } from "./index";

export interface ExperienceStats {
  started: number;
  completed: number;
  productClicks: number;
}

/** Une expérience est un quiz existant. */
export interface ExperienceListItem {
  id: string;
  name: string;
  quizTitle: string;
  industry: string;
  isDefault: boolean;
  catalog: { id: string; name: string };
  /** Quiz actif ET boutique active : c'est la seule condition d'accès public. */
  accessible: boolean;
  /** État du quiz seul (compté dans le quota « Quiz en ligne »), indépendamment de la boutique. */
  active: boolean;
  questionCount: number;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  correction: string | null;
  updatedAt: string;
  /** Plus récente des dates du quiz et de son brouillon enregistré. */
  lastModifiedAt: string;
  /** null lorsqu'aucun événement n'a été enregistré sur la période. */
  stats: ExperienceStats | null;
  occasion: QuizOccasion | null;
  occasionLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface ExperiencesOverview {
  shopActive: boolean;
  period: { from: string; to: string; days: number };
  experiences: ExperienceListItem[];
}
