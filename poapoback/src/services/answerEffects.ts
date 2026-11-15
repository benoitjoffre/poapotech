import type { AnswerEffect, AnswerEffects, ColumnProfile, EffectMissingPolicy } from "@poapo/types";
import { ATTRIBUTE_KEY_PATTERN } from "./importMapping";

/**
 * Effets d'une réponse (lot 10D-2A) : schéma JSON versionné de la future colonne `Answer.effects` (nullable).
 * Module pur et isolé : rien n'est lu ni écrit en base, aucun quiz existant n'est concerné.
 *
 * `Answer.impacts` reste la seule source des préférences sur les AXES. Un effet « axis » ne fait que déclarer le lien avec
 * un axe (il ne porte aucun delta) : le déplacement du profil vient toujours de `impacts`.
 */

export const ANSWER_EFFECTS_VERSION = 1;

export const ANSWER_EFFECTS_LIMITS = {
  /** Effets par réponse. */
  maxEffects: 4,
  /** Valeurs par effet catégoriel. */
  maxValues: 12,
  maxValueLength: 80,
  /** Couverture minimale d'une caractéristique pour qu'une contrainte stricte soit acceptée (données fiables). */
  strictMinCoverage: 0.9,
} as const;

/** `price`, `brand`, `tags` ou `attribute.<clé>` : même identifiant que le diagnostic de colonnes (lot 10B). */
export type CriterionId = string;

export type MissingPolicy = EffectMissingPolicy;
export type { AnswerEffect, AnswerEffects };

export type EffectsParse = { ok: true; value: AnswerEffects } | { ok: false; errors: string[] };

const CRITERION = /^(price|brand|tags|attribute\.[A-Za-z][A-Za-z0-9_]{0,39})$/;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function only(record: Record<string, unknown>, allowed: string[], errors: string[], where: string) {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) errors.push(`${where} : champ inconnu « ${key} »`);
}

/**
 * Validation stricte d'un `effects` lu en base ou envoyé par l'éditeur. `null`/`undefined` = pas d'effets (ancien comportement).
 * Aucun champ inconnu, aucune version inconnue : un contenu qu'on ne sait pas interpréter est refusé, jamais ignoré.
 */
export function parseAnswerEffects(raw: unknown): EffectsParse {
  if (raw === null || raw === undefined) return { ok: true, value: { v: ANSWER_EFFECTS_VERSION, effects: [] } };
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["effects doit être un objet { v, effects }"] };
  only(raw, ["v", "effects"], errors, "effects");
  if (raw.v !== ANSWER_EFFECTS_VERSION) errors.push(`Version d'effets non prise en charge : ${String(raw.v)}`);
  if (!Array.isArray(raw.effects)) return { ok: false, errors: [...errors, "effects.effects doit être une liste"] };
  if (raw.effects.length > ANSWER_EFFECTS_LIMITS.maxEffects) errors.push(`${ANSWER_EFFECTS_LIMITS.maxEffects} effets maximum par réponse`);
  const effects: AnswerEffect[] = [];
  raw.effects.slice(0, ANSWER_EFFECTS_LIMITS.maxEffects).forEach((item, index) => {
    const where = `effet ${index + 1}`;
    if (!isRecord(item)) { errors.push(`${where} : objet attendu`); return; }
    const criterionOk = typeof item.criterion === "string" && CRITERION.test(item.criterion) && (!item.criterion.startsWith("attribute.") || ATTRIBUTE_KEY_PATTERN.test(item.criterion.slice(10)));
    switch (item.type) {
      case "category": {
        only(item, ["type", "criterion", "mode", "values", "onMissing"], errors, where);
        if (!criterionOk) errors.push(`${where} : caractéristique invalide`);
        if (item.mode !== "soft" && item.mode !== "strict") errors.push(`${where} : le mode (soft ou strict) est obligatoire`);
        const values = item.values;
        if (!Array.isArray(values) || values.length === 0 || values.length > ANSWER_EFFECTS_LIMITS.maxValues ||
            values.some((v) => typeof v !== "string" || !v.trim() || v.length > ANSWER_EFFECTS_LIMITS.maxValueLength)) {
          errors.push(`${where} : 1 à ${ANSWER_EFFECTS_LIMITS.maxValues} valeurs texte non vides attendues`);
        }
        checkMissing(item, where, errors);
        if (errors.length === 0) effects.push(item as unknown as AnswerEffect);
        break;
      }
      case "range": {
        only(item, ["type", "criterion", "mode", "min", "max", "onMissing"], errors, where);
        if (!criterionOk) errors.push(`${where} : caractéristique invalide`);
        else if (item.criterion === "brand" || item.criterion === "tags") errors.push(`${where} : une plage numérique ne s'applique pas à ${String(item.criterion)}`);
        if (item.mode !== "soft" && item.mode !== "strict") errors.push(`${where} : le mode (soft ou strict) est obligatoire`);
        if (item.min === undefined && item.max === undefined) errors.push(`${where} : min ou max requis`);
        if (item.min !== undefined && !finite(item.min)) errors.push(`${where} : min invalide`);
        if (item.max !== undefined && !finite(item.max)) errors.push(`${where} : max invalide`);
        if (finite(item.min) && finite(item.max) && item.min > item.max) errors.push(`${where} : min supérieur à max`);
        if (item.criterion === "price" && ((finite(item.min) && item.min < 0) || (finite(item.max) && item.max < 0))) errors.push(`${where} : un prix ne peut pas être négatif`);
        checkMissing(item, where, errors);
        if (errors.length === 0) effects.push(item as unknown as AnswerEffect);
        break;
      }
      case "axis": {
        only(item, ["type", "axis"], errors, where);
        if (typeof item.axis !== "string" || !ATTRIBUTE_KEY_PATTERN.test(item.axis)) errors.push(`${where} : axe invalide`);
        if (errors.length === 0) effects.push(item as unknown as AnswerEffect);
        break;
      }
      case "none": {
        only(item, ["type", "criterion"], errors, where);
        if (!criterionOk) errors.push(`${where} : caractéristique invalide`);
        if (errors.length === 0) effects.push(item as unknown as AnswerEffect);
        break;
      }
      default: errors.push(`${where} : type inconnu « ${String(item.type)} »`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { v: ANSWER_EFFECTS_VERSION, effects } };
}

function checkMissing(item: Record<string, unknown>, where: string, errors: string[]) {
  if (item.onMissing === undefined) return;
  if (item.onMissing !== "exclude" && item.onMissing !== "include") errors.push(`${where} : onMissing doit valoir exclude ou include`);
  else if (item.mode === "soft") errors.push(`${where} : onMissing ne concerne que les contraintes strictes (une préférence souple est toujours neutre)`);
}

/** Un effet « axis » doit s'appuyer sur un impact non nul de la même réponse, sinon la réponse serait décorative. */
export function validateEffectsWithImpacts(effects: AnswerEffects, impacts: Record<string, number>): string[] {
  const issues: string[] = [];
  for (const effect of effects.effects) {
    if (effect.type === "axis" && !(Number.isFinite(impacts[effect.axis]) && impacts[effect.axis] !== 0)) {
      issues.push(`L'effet sur l'axe « ${effect.axis} » n'a aucun impact correspondant : la réponse ne déplacerait rien.`);
    }
  }
  return issues;
}

/**
 * Cohérence avec le catalogue réel (diagnostic 10B) : une préférence exige une caractéristique exploitable ; une contrainte
 * STRICTE exige en plus une couverture d'au moins 90 % (sinon le filtre repose sur des données insuffisamment fiables).
 * Erreurs : tout ce qui rendrait une contrainte stricte non fiable ou impossible. Avertissements : une préférence sans effet réel.
 */
export function inspectEffectsAgainstCatalog(effects: AnswerEffects, profiles: readonly ColumnProfile[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(profiles.map((p) => [p.key, p]));
  for (const effect of effects.effects) {
    if (effect.type === "axis") continue;
    const strict = effect.type !== "none" && effect.mode === "strict";
    const report = (message: string) => (strict ? errors : warnings).push(message);
    const profile = byKey.get(effect.criterion);
    if (!profile) { errors.push(`Caractéristique introuvable dans le catalogue : ${effect.criterion}`); continue; }
    if (!profile.usable) { report(`${effect.criterion} n'est pas exploitable (${profile.rejection?.code ?? "?"}).`); continue; }
    if (effect.type === "none") continue;
    const numeric = profile.inferredType === "RANGE" || profile.inferredType === "NUMERIC";
    if (effect.type === "range" && !numeric) report(`${effect.criterion} n'est pas une mesure numérique.`);
    if (effect.type === "category" && numeric) report(`${effect.criterion} est numérique : utilisez une plage.`);
    if (strict && profile.coverage < ANSWER_EFFECTS_LIMITS.strictMinCoverage) {
      errors.push(`Contrainte stricte refusée sur ${effect.criterion} : renseigné sur ${Math.round(profile.coverage * 100)} % des produits (minimum ${Math.round(ANSWER_EFFECTS_LIMITS.strictMinCoverage * 100)} %).`);
    }
  }
  return { errors, warnings };
}

export function validateEffectsAgainstCatalog(effects: AnswerEffects, profiles: readonly ColumnProfile[]): string[] {
  const { errors, warnings } = inspectEffectsAgainstCatalog(effects, profiles);
  return [...errors, ...warnings];
}
