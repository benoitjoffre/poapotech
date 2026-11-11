import type { CampaignOccasion } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { QuizError } from "./quizzes";

/** Occasion et période facultatives d'une expérience : informatives, jamais utilisées pour l'accès public. */
export const QUIZ_OCCASIONS = [
  "CHRISTMAS", "VALENTINES_DAY", "SPRING", "MOTHERS_DAY", "BACK_TO_SCHOOL", "BLACK_FRIDAY", "PROMOTION", "PERMANENT", "CUSTOM",
] as const satisfies readonly CampaignOccasion[];
export const QUIZ_PERIOD_KEYS = ["occasion", "occasionLabel", "startsAt", "endsAt"] as const;
const OCCASION_LABEL_MAX = 80;

interface CurrentPeriod { occasion: CampaignOccasion | null; occasionLabel: string | null; startsAt: Date | null; endsAt: Date | null }

function dateOrNull(value: unknown, label: string): Date | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new QuizError(400, `${label} doit être une date ISO`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new QuizError(400, `${label} doit être une date valide`);
  return date;
}

/** Applique les champs présents du corps sur l'état courant et valide l'état final. */
export function parseQuizPeriod(body: Record<string, unknown>, current: CurrentPeriod): Prisma.QuizUpdateInput {
  const next: CurrentPeriod = { occasion: current.occasion ?? null, occasionLabel: current.occasionLabel ?? null, startsAt: current.startsAt ?? null, endsAt: current.endsAt ?? null };
  if (body.occasion !== undefined) {
    if (body.occasion !== null && !QUIZ_OCCASIONS.includes(body.occasion as CampaignOccasion)) throw new QuizError(400, "Occasion invalide");
    next.occasion = body.occasion as CampaignOccasion | null;
  }
  if (body.occasionLabel !== undefined) {
    if (body.occasionLabel !== null && typeof body.occasionLabel !== "string") throw new QuizError(400, "Le libellé de l'occasion doit être un texte");
    const label = typeof body.occasionLabel === "string" ? body.occasionLabel.trim() : "";
    if (label.length > OCCASION_LABEL_MAX) throw new QuizError(400, `Le libellé de l'occasion ne doit pas dépasser ${OCCASION_LABEL_MAX} caractères`);
    next.occasionLabel = label || null;
  }
  if (body.startsAt !== undefined) next.startsAt = dateOrNull(body.startsAt, "La date de début");
  if (body.endsAt !== undefined) next.endsAt = dateOrNull(body.endsAt, "La date de fin");
  if (next.occasion !== "CUSTOM") next.occasionLabel = null;
  if (next.occasion === "CUSTOM" && !next.occasionLabel) throw new QuizError(400, "Précisez le nom de l'occasion personnalisée");
  if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) throw new QuizError(400, "La date de fin doit être postérieure à la date de début");
  return next;
}
