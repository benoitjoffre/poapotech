import type { QuizOccasion } from "@poapo/types";

/** Occasion et période d'une expérience : informatives, sans effet sur l'accès public. */
export const OCCASION_LABELS: Record<QuizOccasion, string> = {
  CHRISTMAS: "Noël",
  VALENTINES_DAY: "Saint-Valentin",
  SPRING: "Printemps",
  MOTHERS_DAY: "Fête des Mères",
  BACK_TO_SCHOOL: "Rentrée",
  BLACK_FRIDAY: "Black Friday",
  PROMOTION: "Promotion",
  PERMANENT: "Toute l'année",
  CUSTOM: "Autre occasion",
};
export const OCCASIONS = Object.keys(OCCASION_LABELS) as QuizOccasion[];

interface PeriodLike {
  occasion?: QuizOccasion | null;
  occasionLabel?: string | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
}

export function occasionName(item: PeriodLike): string | null {
  if (!item.occasion) return null;
  return item.occasion === "CUSTOM" && item.occasionLabel ? item.occasionLabel : OCCASION_LABELS[item.occasion];
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** « 1 déc. → 24 déc. 2026 », « À partir du… », « Jusqu'au… » ; null sans période. */
export function periodText(item: PeriodLike): string | null {
  if (!item.startsAt && !item.endsAt) return null;
  const start = item.startsAt ? new Date(item.startsAt) : null;
  const end = item.endsAt ? new Date(item.endsAt) : null;
  if (start && end) return `${start.getFullYear() === end.getFullYear() ? dayMonth.format(start) : fullDate.format(start)} → ${fullDate.format(end)}`;
  if (start) return `À partir du ${fullDate.format(start)}`;
  return `Jusqu'au ${fullDate.format(end!)}`;
}

/** « Noël · 1 déc. → 24 déc. 2026 », ou null si rien n'est renseigné. */
export function periodSummary(item: PeriodLike): string | null {
  const parts = [occasionName(item), periodText(item)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Date ISO → valeur d'un input type="date" (jour local). */
export function toDateInput(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Valeur d'un input type="date" → ISO ; la fin couvre toute la journée locale. */
export function fromDateInput(value: string, endOfDay = false): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
  return date.toISOString();
}
