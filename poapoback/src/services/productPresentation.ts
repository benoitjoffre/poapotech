import type { QuizAxis } from "@poapo/types";
import { prisma } from "../lib/prisma";

/**
 * Présentation publique d'un produit recommandé (lot 10D-2E). Pure, sans secteur, sans effet sur le moteur.
 *
 * Règle universelle — sélection EXPLICITE plutôt que liste noire :
 *   une caractéristique n'est montrée au visiteur que si le quiz l'utilise lui-même :
 *     - un axe du quiz (barre « profil », libellé défini par le commerçant) ;
 *     - une caractéristique sur laquelle une réponse du quiz porte une préférence ou une contrainte (`Answer.effects`).
 *   Tout le reste (EAN, SKU, références internes, champs techniques, valeurs JSON) n'est ni affiché ni même transmis.
 *   Le prix, la marque, la description et les mots-clés restent affichés comme avant, par leurs champs dédiés.
 *
 * Libellé visiteur (priorité) : 1. libellé de l'axe défini par le commerçant ; 2. en-tête d'origine du CSV (sans l'unité, qui suit la
 * valeur) ; 3. libellé lisible dérivé de la clé. La clé technique n'est jamais modifiée.
 */

export const MAX_CHARACTERISTICS = 4;

export interface PresentationContext {
  axes: QuizAxis[];
  /** Clés d'attributs (sans « attribute. ») sur lesquelles portent les réponses du quiz, dans l'ordre des questions. */
  criteria: string[];
  /** En-têtes d'origine des colonnes importées (clé → en-tête). */
  labels: Record<string, string>;
}

export interface Characteristic { key: string; label: string; value: string }

/** « famille_olfactive » → « Famille olfactive » ; « tailleEu » → « Taille eu ». Jamais d'accent inventé. */
export function humanizeKey(key: string): string {
  const text = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/** « Contenance (ml) » → { label: « Contenance », unit: « ml » }. */
export function splitHeader(header: string): { label: string; unit: string | null } {
  const match = /^(.*?)\s*\(([^()]{1,12})\)\s*$/.exec(header.trim());
  return match && match[1].trim() ? { label: match[1].trim(), unit: match[2].trim() } : { label: header.trim(), unit: null };
}

export function visitorLabel(key: string, context: PresentationContext): { label: string; unit: string | null } {
  const axis = context.axes.find((item) => item.key === key);
  if (axis?.label && axis.label !== key) return { label: axis.label, unit: null };
  const header = context.labels[key];
  if (header) return splitHeader(header);
  return { label: humanizeKey(key), unit: null };
}

function formatValue(value: unknown, unit: string | null): string | null {
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace(".", ",");
    return unit ? `${text} ${unit}` : text;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.length > 60) return null;
    if (["true", "oui", "yes"].includes(text.toLowerCase())) return "Oui";
    if (["false", "non", "no"].includes(text.toLowerCase())) return "Non";
    return unit && /^-?\d+([.,]\d+)?$/.test(text) ? `${text} ${unit}` : text;
  }
  return null; // tableaux, objets, null : jamais affichés
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Attributs transmis au widget : uniquement les clés présentables, valeurs simples. */
export function publicAttributes(attributes: unknown, context: PresentationContext): Record<string, string | number | boolean> {
  const allowed = new Set([...context.axes.map((axis) => axis.key), ...context.criteria]);
  return Object.fromEntries(Object.entries(asRecord(attributes)).flatMap(([key, value]) =>
    allowed.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean") ? [[key, value]] : []));
}

/** Caractéristiques à afficher (hors axes, déjà montrés en barres), au plus MAX_CHARACTERISTICS, dans l'ordre des questions. */
export function characteristics(attributes: unknown, context: PresentationContext): Characteristic[] {
  const axisKeys = new Set(context.axes.map((axis) => axis.key));
  const values = asRecord(attributes);
  const out: Characteristic[] = [];
  for (const key of [...new Set(context.criteria)]) {
    if (axisKeys.has(key) || !(key in values)) continue;
    const { label, unit } = visitorLabel(key, context);
    const value = formatValue(values[key], unit);
    if (value === null) continue;
    out.push({ key, label, value });
    if (out.length >= MAX_CHARACTERISTICS) break;
  }
  return out;
}

/** Explications du moteur au vouvoiement (le texte vient du service Python, qui n'est pas modifié). */
export function formalExplanation(lines: readonly string[]): string[] {
  return lines.map((line) => line
    .replace(/Correspond à ta préférence/g, "Correspond à votre préférence")
    .replace(/de tes réponses/g, "de vos réponses")
    .replace(/\bta préférence\b/g, "votre préférence")
    .replace(/\btes préférences\b/g, "vos préférences"));
}

/** Critères du quiz : clés d'attributs visées par les effets des réponses (préférence ou contrainte), dans l'ordre fourni. */
export function criteriaFromEffects(effectsList: readonly unknown[]): string[] {
  const keys: string[] = [];
  for (const raw of effectsList) {
    const effects = asRecord(raw).effects;
    if (!Array.isArray(effects)) continue;
    for (const effect of effects) {
      const criterion = asRecord(effect).criterion;
      const type = asRecord(effect).type;
      if ((type === "category" || type === "range") && typeof criterion === "string" && criterion.startsWith("attribute.")) keys.push(criterion.slice("attribute.".length));
    }
  }
  return [...new Set(keys)];
}

/** En-têtes d'origine des imports terminés d'un catalogue (lecture seule, jamais bloquante). */
export async function catalogLabels(tenantId: string, catalogId: string): Promise<Record<string, string>> {
  const batches = await prisma.importBatch.findMany({
    where: { tenantId, catalogId, status: "completed" }, orderBy: { createdAt: "asc" }, select: { result: true }, take: 50,
  }).catch(() => []);
  const labels: Record<string, string> = {};
  for (const batch of batches) {
    const value = asRecord(batch.result).labels;
    for (const [key, header] of Object.entries(asRecord(value))) if (typeof header === "string" && header.trim()) labels[key] = header.trim().slice(0, 80);
  }
  return labels;
}

/** Contexte de présentation d'un quiz publié : axes, critères visés par ses réponses actives, en-têtes du catalogue. */
export async function publishedPresentationContext(tenantId: string, quiz: { id: string; catalogId: string }, axes: QuizAxis[]): Promise<PresentationContext> {
  const [answers, labels] = await Promise.all([
    prisma.answer.findMany({
      where: { active: true, question: { tenantId, quizId: quiz.id, active: true } },
      select: { effects: true, question: { select: { order: true } } }, orderBy: [{ question: { order: "asc" } }, { order: "asc" }],
    }).catch(() => []),
    catalogLabels(tenantId, quiz.catalogId),
  ]);
  return { axes, criteria: criteriaFromEffects(answers.map((a) => a.effects)), labels };
}

/** Produit public prêt pour le widget : attributs filtrés, caractéristiques lisibles, explication au vouvoiement. */
export function presentProduct<T extends { attributes: unknown }>(product: T, explanation: readonly string[], context: PresentationContext) {
  return {
    product: { ...product, attributes: publicAttributes(product.attributes, context) },
    characteristics: characteristics(product.attributes, context),
    explanation: formalExplanation(explanation),
  };
}
