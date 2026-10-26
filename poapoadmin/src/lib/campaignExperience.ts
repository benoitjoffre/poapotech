import type { CampaignStatus, ExperienceListItem } from "@poapo/types";
import { publicAvailability, type PublicAvailability } from "./experiences";

/** Distinction affichée partout où une campagne et son expérience cohabitent. */
export const DIFFUSION_NOTE =
  "Les dates et le statut d'une campagne servent à organiser vos opérations marketing. Ils n'activent ni ne désactivent l'accès public du quiz : celui-ci se gère depuis l'éditeur de l'expérience.";

export const SHARED_NOTE =
  "Une campagne utilise l'expérience sans en posséder de copie : plusieurs campagnes peuvent partager la même expérience, et toute modification de celle-ci s'applique à toutes.";

/**
 * Accessibilité publique du quiz (boutique active ET quiz actif, comme l'API publique).
 * `null` lorsque l'état de la boutique est inconnu et que le quiz est actif.
 */
export function quizAccess(shopActive: boolean | null, quizActive: boolean): PublicAvailability | null {
  if (!quizActive) return publicAvailability({ shopActive: shopActive ?? true, quizActive: false });
  if (shopActive === null) return null;
  return publicAvailability({ shopActive, quizActive });
}

/** Autres campagnes qui partagent le quiz de l'expérience. */
export function otherCampaigns(experience: ExperienceListItem | undefined, campaignId?: string) {
  return (experience?.campaigns ?? []).filter((campaign) => campaign.id !== campaignId);
}

export function sharedLabel(others: number): string {
  if (others === 0) return "Aucune autre campagne ne l'utilise";
  return `Partagée avec ${others} autre${others > 1 ? "s" : ""} campagne${others > 1 ? "s" : ""}`;
}

/** Même règle que le serveur : seules les campagnes en brouillon sont supprimables. */
export function canDeleteCampaign(status: CampaignStatus): boolean {
  return status === "DRAFT";
}

/** Reflet de la validation serveur (qui reste l'autorité) pour prévenir l'utilisateur avant l'envoi. */
export function statusBlockedReason(status: CampaignStatus, quizActive: boolean | undefined, startsAt: string): string | null {
  if (status === "SCHEDULED" && !startsAt) return "Une campagne programmée nécessite une date de début.";
  if ((status === "SCHEDULED" || status === "ACTIVE") && quizActive === false) {
    return "Le quiz associé est désactivé : activez-le depuis l'éditeur de l'expérience avant de programmer ou démarrer la campagne.";
  }
  return null;
}

export function datesProblem(startsAt: string, endsAt: string): string | null {
  return startsAt && endsAt && endsAt < startsAt ? "La date de fin doit être postérieure à la date de début." : null;
}

export const STATUS_HINTS: Record<CampaignStatus, string> = {
  DRAFT: "En préparation : la campagne n'est pas encore suivie comme une opération en cours.",
  SCHEDULED: "Passe automatiquement « En cours » à la date de début (affichage dans POAPO uniquement).",
  ACTIVE: "Opération en cours (ou à partir de la date de début si elle est future).",
  PAUSED: "Opération suspendue, reprenable à tout moment.",
  COMPLETED: "Opération clôturée.",
};
