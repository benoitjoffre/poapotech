/**
 * Lecture des valeurs d'un CSV à l'import (lot 10C). Responsabilité distincte de catalogProfile.ts :
 * ici on VALIDE et convertit une cellule ; le profilage décrit des colonnes déjà enregistrées.
 */

export type PriceResult =
  | { ok: true; value: number }
  | { ok: false; reason: "negative" | "ambiguous" | "invalid" };

const CURRENCY_PREFIX = /^(?:€|eur|euros?)\s*/i;
const CURRENCY_SUFFIX = /\s*(?:€|eur|euros?)$/i;

/**
 * Prix non ambigu uniquement. Acceptés : `49`, `49.00`, `49,00`, `49,00 €`, `€ 49`, `1 234,56`, `1.234,56`, `1,234.56`, `1 234`.
 * Refusés : prix négatif, texte, et les formes ambiguës (`1.234`, `1,234`, `12,345` : milliers ou décimales ?).
 * Un seul symbole monétaire (€, EUR, euro) est toléré, d'un seul côté.
 */
export function parsePrice(raw: string): PriceResult {
  let text = raw.replace(/[   ]/g, " ").trim();
  if (/^[-−]/.test(text)) return { ok: false, reason: "negative" };
  if (CURRENCY_PREFIX.test(text)) text = text.replace(CURRENCY_PREFIX, "");
  else if (CURRENCY_SUFFIX.test(text)) text = text.replace(CURRENCY_SUFFIX, "");
  text = text.trim();
  if (/^[-−]/.test(text)) return { ok: false, reason: "negative" };
  if (!/^\d[\d .,]*$/.test(text) || /[.,]$/.test(text)) return { ok: false, reason: "invalid" };

  const done = (digits: string) => {
    const value = Number(digits);
    return Number.isFinite(value) ? { ok: true as const, value } : { ok: false as const, reason: "invalid" as const };
  };
  if (/^\d+$/.test(text)) return done(text);
  // Milliers séparés par des espaces, décimales facultatives (1 à 2 chiffres).
  let match = /^(\d{1,3}(?: \d{3})+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (match) return done(`${match[1].replace(/ /g, "")}${match[2] ? `.${match[2]}` : ""}`);
  if (text.includes(" ")) return { ok: false, reason: "invalid" };
  // Un seul séparateur : décimal, sauf « 1.234 » / « 12,345 » (trois chiffres après, 1 à 3 avant) : ambigu.
  match = /^(\d+)[.,](\d+)$/.exec(text);
  if (match) {
    if (match[2].length === 3 && match[1].length <= 3 && !match[1].startsWith("0")) return { ok: false, reason: "ambiguous" };
    return done(`${match[1]}.${match[2]}`);
  }
  // Même séparateur répété : milliers (1.234.567 ou 1,234,567).
  match = /^(\d{1,3}(?:[.,]\d{3}){2,})$/.exec(text);
  if (match && new Set(text.replace(/\d/g, "")).size === 1) return done(text.replace(/[.,]/g, ""));
  // Format européen (1.234,56) ou anglo-saxon (1,234.56).
  match = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(text);
  if (match) return done(`${match[1].replace(/\./g, "")}.${match[2]}`);
  match = /^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/.exec(text);
  if (match) return done(`${match[1].replace(/,/g, "")}.${match[2]}`);
  return { ok: false, reason: "invalid" };
}

/**
 * Valeur d'un attribut libre. Comportement historique conservé (un nombre écrit `12,5` ou `0.7` devient un nombre) avec deux
 * garde-fous contre une conversion irréversible : un code à zéros initiaux (`007`) ou un entier de plus de 15 chiffres reste du texte.
 */
export function parseAttributeValue(raw: string): number | string {
  const normalized = raw.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return raw;
  // Codes à zéros initiaux et très longs entiers (EAN…) restent du texte ; un décimal très précis (export de tableur : 0,33999999999999997) est bien un nombre.
  const integer = /^-?\d+$/.test(raw);
  if (/^-?0\d/.test(raw) || (integer && raw.replace(/\D/g, "").length > 15)) return raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : raw;
}

/** Au-delà, une valeur d'attribut est signalée (jamais tronquée ni refusée). */
export const ATTRIBUTE_VALUE_WARN_LENGTH = 500;
