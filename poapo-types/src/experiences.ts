import type { CampaignOccasion, CampaignStatus } from "./index";

/** Campagne rattachée à un quiz : simple référence, jamais une copie du quiz. */
export interface ExperienceCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  effectiveStatus: CampaignStatus;
  occasion: CampaignOccasion;
  occasionLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
}

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
  questionCount: number;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  correction: string | null;
  updatedAt: string;
  /** Plus récente des dates du quiz et de son brouillon enregistré. */
  lastModifiedAt: string;
  /** null lorsqu'aucun événement n'a été enregistré sur la période. */
  stats: ExperienceStats | null;
  campaigns: ExperienceCampaign[];
}

export interface ExperiencesOverview {
  shopActive: boolean;
  period: { from: string; to: string; days: number };
  experiences: ExperienceListItem[];
}
