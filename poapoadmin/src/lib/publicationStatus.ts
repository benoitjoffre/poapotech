/** État public réel d'une expérience, tel que renvoyé par `/api/experiences` (jamais déduit de l'état local seul). */
export interface ServerPublicationState {
  shopActive: boolean;
  /** boutique active ET quiz actif — même règle que l'API publique ; le statut des campagnes n'intervient pas. */
  accessible: boolean;
  /** Questions de la version publiée (live), pas du brouillon. */
  questionCount: number;
  /** Un brouillon enregistré existe côté serveur. */
  hasDraft: boolean;
}

export type PublicationStatusId = "unpublished" | "changes" | "live" | "disabled";

export interface PublicationStatus {
  id: PublicationStatusId;
  label: string;
  /** Ce qu'il reste à faire pour le commerçant. */
  hint: string;
  /** Raison d'inaccessibilité quand une version est publiée mais fermée au public. */
  reason: string | null;
}

/**
 * - rien de publié (aucune question en ligne)      → « Brouillon non publié »
 * - brouillon enregistré ou modifications locales  → « Modifications non publiées »
 * - publié, boutique et quiz actifs                → « Publié et accessible »
 * - publié, mais boutique ou quiz désactivé        → « Publié mais désactivé »
 */
export function publicationStatus(server: ServerPublicationState, localChanges: boolean): PublicationStatus {
  const reason = server.accessible ? null : server.shopActive ? "Quiz désactivé" : "Boutique désactivée";
  if (server.questionCount === 0) {
    return { id: "unpublished", label: "Brouillon non publié", reason: null,
      hint: "Votre expérience n'est pas encore visible par vos visiteurs. Publiez-la pour la rendre accessible." };
  }
  if (server.hasDraft || localChanges) {
    return { id: "changes", label: "Modifications non publiées", reason,
      hint: `Vos visiteurs voient encore la version précédente. Publiez pour appliquer vos modifications${reason ? ` (actuellement fermée au public : ${reason.toLowerCase()})` : ""}.` };
  }
  if (!server.accessible) {
    return { id: "disabled", label: "Publié mais désactivé", reason,
      hint: server.shopActive
        ? "La version est publiée mais fermée au public. Publiez et rendez accessible pour l'ouvrir."
        : "La version est publiée mais votre boutique est désactivée : réactivez-la dans les paramètres." };
  }
  return { id: "live", label: "Publié et accessible", reason: null, hint: "Vos visiteurs peuvent ouvrir cette expérience." };
}

/** Une action de publication a-t-elle encore un sens ? (rien à publier si tout est publié et accessible) */
export function canPublishAndActivate(status: PublicationStatus, shopActive: boolean): boolean {
  return status.id !== "live" && !(status.id === "disabled" && !shopActive);
}
