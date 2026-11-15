/**
 * Éligibilité au générateur avancé de questions. Elle ne concerne que la CRÉATION d'un nouveau quiz avancé par le parcours Express
 * (génération, validation, aperçu et enregistrement d'un brouillon Express). Lire, modifier, enregistrer, prévisualiser,
 * publier et servir un quiz avancé EXISTANT ne dépend jamais de ces variables : un quiz déjà créé reste pleinement utilisable.
 *
 *   EXPRESS_UNIVERSAL_QUESTIONS non défini ou autre valeur : désactivé pour tous.
 *   EXPRESS_UNIVERSAL_QUESTIONS=1                          : ouvert à tous les comptes.
 *   EXPRESS_UNIVERSAL_QUESTIONS=pilot                      : réservé aux comptes listés dans EXPRESS_UNIVERSAL_TENANTS (identifiants séparés par des virgules).
 */
export type UniversalMode = "off" | "all" | "pilot";

export function universalMode(): UniversalMode {
  const value = process.env.EXPRESS_UNIVERSAL_QUESTIONS;
  return value === "1" ? "all" : value === "pilot" ? "pilot" : "off";
}

/** La fonctionnalité existe-t-elle au moins pour certains comptes ? */
export const universalQuestionsEnabled = (): boolean => universalMode() !== "off";

/** Ce compte peut-il créer un nouveau quiz avancé ? */
export function universalAllowedFor(tenantId: string | null | undefined): boolean {
  const mode = universalMode();
  if (mode === "all") return true;
  if (mode === "off" || !tenantId) return false;
  return (process.env.EXPRESS_UNIVERSAL_TENANTS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(tenantId);
}
