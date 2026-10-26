import type { QuizAxis } from "@poapo/types";
import { axisKeyFromLabel } from "./axisKey";

export const WIZARD_STEPS = [
  { id: "products", label: "Mes produits" },
  { id: "preferences", label: "Mes préférences" },
  { id: "questions", label: "Mes questions" },
  { id: "appearance", label: "Personnaliser et tester" },
  { id: "publication", label: "Vérifier et publier" },
] as const;
export type WizardStepId = typeof WIZARD_STEPS[number]["id"];

export interface WizardProgress {
  catalogId: string;
  recommendableProducts: number | null;
  axisCount: number;
  playableQuestions: number;
}

/** Une étape est « complète » si son contenu minimal existe ; aucune valeur n'est inventée. */
export function stepComplete(id: WizardStepId, progress: WizardProgress): boolean {
  switch (id) {
    case "products": return !!progress.catalogId && (progress.recommendableProducts ?? 0) > 0;
    case "preferences": return progress.axisCount > 0;
    case "questions": return progress.playableQuestions > 0;
    default: return false;
  }
}

/** Étape de reprise : la première étape de contenu incomplète, sinon la personnalisation. */
export function resumeStep(progress: WizardProgress): number {
  const index = (["products", "preferences", "questions"] as const).findIndex((id) => !stepComplete(id, progress));
  return index === -1 ? 4 : index + 1;
}

export function parseStep(value: string | null): number | null {
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= WIZARD_STEPS.length ? step : null;
}

export interface AxisExample {
  label: string;
  lowLabel: string;
  highLabel: string;
}

const GENERIC: AxisExample[] = [
  { label: "Budget", lowLabel: "Économique", highLabel: "Haut de gamme" },
  { label: "Style", lowLabel: "Classique", highLabel: "Original" },
  { label: "Confort", lowLabel: "Simple", highLabel: "Luxueux" },
];

const BY_SECTOR: Array<{ match: RegExp; examples: AxisExample[] }> = [
  { match: /voyage|s[ée]jour|tourisme/i, examples: [
    { label: "Rythme", lowLabel: "Détente", highLabel: "Aventure" },
    { label: "Culture", lowLabel: "Nature", highLabel: "Patrimoine" },
    { label: "Budget", lowLabel: "Économique", highLabel: "Haut de gamme" },
  ] },
  { match: /parfum|cosm[ée]tique|beaut[ée]|soin/i, examples: [
    { label: "Intensité", lowLabel: "Discrète", highLabel: "Puissante" },
    { label: "Fraîcheur", lowLabel: "Chaleureux", highLabel: "Frais" },
    { label: "Budget", lowLabel: "Accessible", highLabel: "Prestige" },
  ] },
  { match: /caf[ée]|th[ée]|torr[ée]faction/i, examples: [
    { label: "Acidité", lowLabel: "Douce", highLabel: "Vive" },
    { label: "Intensité", lowLabel: "Légère", highLabel: "Corsée" },
    { label: "Budget", lowLabel: "Économique", highLabel: "Haut de gamme" },
  ] },
  { match: /mode|v[êe]tement|textile|chaussure/i, examples: [
    { label: "Style", lowLabel: "Classique", highLabel: "Original" },
    { label: "Confort", lowLabel: "Ajusté", highLabel: "Décontracté" },
    { label: "Budget", lowLabel: "Économique", highLabel: "Haut de gamme" },
  ] },
  { match: /aliment|vin|[ée]picerie|gastronom|boisson/i, examples: [
    { label: "Intensité", lowLabel: "Délicat", highLabel: "Puissant" },
    { label: "Originalité", lowLabel: "Traditionnel", highLabel: "Surprenant" },
    { label: "Budget", lowLabel: "Économique", highLabel: "Haut de gamme" },
  ] },
];

/** Suggestions d'axes selon l'activité saisie ; elles ne sont ajoutées qu'à la demande de l'utilisateur. */
export function axisExamples(industry: string): AxisExample[] {
  return BY_SECTOR.find((entry) => entry.match.test(industry))?.examples ?? GENERIC;
}

export const SECTOR_SUGGESTIONS = ["Voyage", "Parfum", "Café", "Mode", "Alimentaire"] as const;

/** Ajoute un exemple en conservant les clés existantes ; renvoie null s'il est déjà présent. */
export function addExampleAxis(axes: Array<QuizAxis & { isNew?: boolean }>, example: AxisExample) {
  const base = axisKeyFromLabel(example.label) || "axe";
  if (axes.some((axis) => axis.label.trim().toLowerCase() === example.label.toLowerCase())) return null;
  let key = base;
  for (let n = 2; axes.some((axis) => axis.key === key); n++) key = `${base}${n}`.slice(0, 40);
  return { key, label: example.label, lowLabel: example.lowLabel, highLabel: example.highLabel, isNew: true };
}
