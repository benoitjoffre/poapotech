import type { QuizAxis } from "@poapo/types";

/**
 * Profil envoyé au moteur de recommandation : chaque axe du quiz part de 0.5, puis les impacts
 * des réponses choisies s'ajoutent dans l'ordre, borné entre 0 et 1 après chaque ajout.
 */
export function computeProfile(axes: QuizAxis[], impactsList: unknown[]): Record<string, number> {
  const profile: Record<string, number> = Object.fromEntries(axes.map((axis) => [axis.key, 0.5]));
  for (const raw of impactsList) {
    if (!raw || typeof raw !== "object") continue;
    for (const [axis, impact] of Object.entries(raw as Record<string, unknown>)) {
      if (!(axis in profile) || typeof impact !== "number" || !Number.isFinite(impact)) continue;
      profile[axis] = Math.max(0, Math.min(1, profile[axis] + impact));
    }
  }
  return profile;
}
