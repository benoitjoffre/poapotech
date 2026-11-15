import type { DashboardExperience, DashboardSummary } from "@poapo/types";
import { experienceEditorPath } from "./experienceLinks";

export interface Step {
  id: "products" | "quiz" | "publish" | "site";
  title: string;
  help: string;
  done: boolean;
  cta: string;
  to: string;
  /** Où revenir sur cette étape une fois terminée. */
  review: string;
}

/** Quiz réellement commencés par le commerçant : le quiz par défaut vide créé à l'inscription n'en fait pas partie. */
export function createdQuizzes(summary: DashboardSummary): DashboardExperience[] {
  return summary.experiences.filter((item) => item.hasDraft || (item.questionCount ?? 1) > 0);
}

export type HomeStateKind = "new" | "progress" | "live";
export interface HomeState {
  kind: HomeStateKind;
  /** Quiz à reprendre (brouillon d'abord) ou quiz en ligne ; null pour un nouveau commerçant. */
  quiz: DashboardExperience | null;
  /** Des visiteurs ont commencé un quiz : seul signal d'usage disponible, ce n'est pas une preuve d'installation sur le site. */
  used: boolean;
  /** Prochaine action réelle pour le quiz à reprendre. */
  nextText: string;
}

/** Les trois états de l'accueil, déduits des mêmes données que les étapes (aucun second suivi de progression). */
export function homeState(summary: DashboardSummary): HomeState {
  const created = createdQuizzes(summary);
  const used = summary.totals.started > 0;
  if (!created.length) return { kind: "new", quiz: null, used, nextText: "" };
  const live = created.find((item) => item.accessible);
  if (live) return { kind: "live", quiz: live, used, nextText: "" };
  const quiz = created.find((item) => item.hasDraft) ?? created[0];
  const nextText = quiz.correction ? `À corriger avant de publier : ${quiz.correction.replace(/\.$/, "")}.`
    : quiz.hasDraft ? "Vos modifications sont enregistrées : il reste à les publier."
    : "Dernière étape : publier votre quiz pour que vos visiteurs le voient.";
  return { kind: "progress", quiz, used, nextText };
}

/** Les étapes pour mettre un quiz en ligne, dans l'ordre. Chaque étape est cochée d'après l'état réel du compte. */
export function homeSteps(summary: DashboardSummary): Step[] {
  // Le quiz par défaut créé à l'inscription n'a aucune question : ce n'est pas un quiz que le commerçant a créé.
  const created = createdQuizzes(summary);
  const quiz = created.find((item) => !item.accessible) ?? created[0];
  const live = created.find((item) => item.accessible);
  return [
    { id: "products", title: "Ajoutez vos produits", help: "Importez un fichier ou saisissez-les un par un. Ce sont eux que votre quiz recommandera.",
      done: summary.products > 0, cta: "Ajouter mes produits", to: "/catalog", review: "/catalog" },
    { id: "quiz", title: "Préparez votre quiz", help: "POAPO prépare les questions à partir de vos produits. Vous relisez et modifiez.",
      done: created.length > 0, cta: "Créer mon quiz", to: "/experiences/new", review: "/quizzes" },
    { id: "publish", title: "Publiez-le", help: "Testez-le dans l'aperçu, puis cliquez sur « Publier » pour le rendre visible.",
      done: !!live, cta: "Publier mon quiz", to: quiz ? experienceEditorPath(quiz.id, "publication") : "/experiences/new", review: live ? experienceEditorPath(live.id, "publication") : "/quizzes" },
    { id: "site", title: "Installez-le sur votre site", help: "Copiez le lien ou le code à coller sur votre site. Vos premiers résultats apparaîtront ici.",
      done: summary.totals.started > 0, cta: "Voir le code d'installation", to: live ? experienceEditorPath(live.id, "publication") : "/experiences/new", review: live ? experienceEditorPath(live.id, "publication") : "/quizzes" },
  ];
}
