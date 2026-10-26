import type { ResultsCounts, ResultsExperienceRow } from "@poapo/types";

export type MetricKey = keyof ResultsCounts;
export type SortKey = "name" | MetricKey;

export const METRICS: { key: MetricKey; label: string; help: string }[] = [
  { key: "started", label: "Démarrages de quiz", help: "Nombre de fois où un visiteur a commencé une de vos expériences. Un visiteur qui recommence est compté plusieurs fois." },
  { key: "completed", label: "Quiz terminés", help: "Nombre de fois où un visiteur est allé jusqu'à la dernière question." },
  { key: "recommendations", label: "Recommandations générées", help: "Nombre de sélections de produits affichées à des visiteurs, enregistrées par POAPO." },
  { key: "productClicks", label: "Clics vers les produits", help: "Clics sur le bouton d'un produit recommandé. Ce ne sont pas des ventes." },
];

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** Variation en % par rapport à la période précédente ; null si la comparaison n'a pas de sens (base nulle). */
export function trend(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatTrend(value: number | null): string {
  if (value === null) return "Pas de comparaison";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("fr-FR")} %`;
}

export function filterExperiences(rows: ResultsExperienceRow[], search: string, catalogId: string): ResultsExperienceRow[] {
  const needle = search.trim().toLocaleLowerCase("fr");
  return rows.filter((row) =>
    (!catalogId || row.catalogId === catalogId) && (!needle || row.name.toLocaleLowerCase("fr").includes(needle)));
}

export function sortExperiences(rows: ResultsExperienceRow[], key: SortKey): ResultsExperienceRow[] {
  return [...rows].sort((a, b) => key === "name"
    ? a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id)
    : b[key] - a[key] || a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Jours UTC entiers, aujourd'hui inclus : [début du jour UTC − (days − 1), début du jour UTC suivant[. Même convention que l'API. */
export function periodQuery(days: number, now = new Date()): string {
  const DAY = 24 * 60 * 60 * 1000;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY);
  const from = new Date(to.getTime() - days * DAY);
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString() }).toString();
}
