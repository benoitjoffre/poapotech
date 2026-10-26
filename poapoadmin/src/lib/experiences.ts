import type { CampaignStatus, ExperienceListItem } from "@poapo/types";

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

/** Libellés de campagne : ils décrivent la campagne, jamais l'accès public du quiz. */
export const CAMPAIGN_STATE_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Brouillon", SCHEDULED: "Programmée", ACTIVE: "En cours", PAUSED: "En pause", COMPLETED: "Terminée",
};

export function campaignCountLabel(count: number): string {
  return count === 0 ? "Aucune campagne" : `${count} campagne${count > 1 ? "s" : ""}`;
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
