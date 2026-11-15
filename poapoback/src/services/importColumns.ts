import type { ColumnProfile, ImportColumnInsight, ImportColumnKind } from "@poapo/types";
import { profileColumns } from "./catalogProfile";
import {
  attributeKeyFromHeader, freeAttributeKey, isAmbiguousHeader, MAX_ATTRIBUTE_COLUMNS, type FieldMapping,
} from "./importMapping";
import { parseAttributeValue } from "./importValues";

/**
 * Lecture des colonnes d'un fichier avant import (lot 10C). Fonction pure, sans secteur : elle réutilise le diagnostic du
 * lot 10B pour décrire chaque colonne telle qu'elle serait enregistrée comme information supplémentaire, et propose une
 * destination pour les colonnes non reconnues. Rien n'est appliqué : le commerçant confirme.
 */

const EXAMPLE_LENGTH = 60;

function kindOf(profile: ColumnProfile): ImportColumnKind {
  if (profile.productCount === 0) return "empty";
  const code = profile.rejection?.code;
  if (code === "IDENTIFIER_LIKE") return "identifier";
  if (code === "UNSUPPORTED_STRUCTURE" || code === "HIGH_CARDINALITY") return "text";
  if (code === "INVALID_VALUES") return "mixed";
  if (profile.valueKind === "boolean" || (profile.valueKind === "number" && profile.inferredType === "CATEGORICAL")) return "yesno";
  if (profile.valueKind === "number") return "number";
  return "category";
}

function notesFor(profile: ColumnProfile, total: number): string[] {
  const notes: string[] = [];
  const filled = profile.productCount;
  switch (profile.rejection?.code) {
    case "INSUFFICIENT_COVERAGE": if (filled > 0) notes.push(`Peu renseignée : ${filled} ligne(s) sur ${total}.`); break;
    case "CONSTANT_VALUE": notes.push("La même valeur partout : peu utile pour comparer les produits."); break;
    case "INSUFFICIENT_VARIATION": notes.push("Presque tous les produits ont la même valeur : peu utile pour les comparer."); break;
    case "HIGH_CARDINALITY": notes.push("Presque toutes les valeurs sont différentes : peu utile pour comparer les produits."); break;
    case "UNSUPPORTED_STRUCTURE": notes.push("Texte long : conservé tel quel, mais peu adapté à une question de quiz."); break;
    case "INVALID_VALUES": notes.push("Mélange de types de valeurs (par exemple nombres et texte) : vérifiez cette colonne."); break;
    case "IDENTIFIER_LIKE": notes.push("Ressemble à une référence ou à un code : à conserver seulement si utile."); break;
    default: break;
  }
  for (const warning of profile.warnings) {
    if (warning.code === "PARTIAL_COVERAGE") notes.push(`Renseignée sur ${filled} ligne(s) sur ${total} : les autres ne seront pas départagées.`);
    if (warning.code === "MERGED_VARIANTS") notes.push("Une même valeur est écrite de plusieurs façons (majuscules, espaces) : les données restent telles quelles.");
    if (warning.code === "IMBALANCED_DISTRIBUTION") notes.push("Une valeur domine très largement.");
  }
  return notes;
}

/**
 * @param suggested correspondances déjà reconnues (champs produit et axes) : jamais modifiées ni écrasées.
 * @param axisKeys clés des axes du catalogue : réservées (un axe exige des valeurs entre 0 et 1).
 */
export function describeImportColumns(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
  suggested: readonly FieldMapping[],
  axisKeys: ReadonlySet<string>,
): ImportColumnInsight[] {
  // Nom d'attribut = clé normalisée de l'en-tête (unique), pour que le diagnostic reconnaisse par exemple une « réf » comme identifiant.
  const names: string[] = [];
  headers.forEach((header, index) => {
    const base = attributeKeyFromHeader(header) ?? "col";
    names.push(names.includes(base) ? `${base}_${index}` : base);
  });
  const products = rows.map((row) => {
    const attributes: Record<string, number | string> = {};
    headers.forEach((header, index) => {
      const raw = (row[header] ?? "").trim();
      if (raw) attributes[names[index]] = parseAttributeValue(raw);
    });
    return { attributes };
  });
  const profiles = new Map(profileColumns(products).map((profile) => [profile.name, profile]));
  const recognized = new Map(suggested.filter((m) => m.targetField).map((m) => [m.sourceColumn, m.targetField!]));
  const taken = new Set<string>(axisKeys);
  for (const target of recognized.values()) if (target.startsWith("attribute.")) taken.add(target.slice("attribute.".length));
  let attributeCount = [...recognized.values()].filter((target) => target.startsWith("attribute.")).length;

  return headers.map((header, index) => {
    const profile = profiles.get(names[index]);
    const filled = profile?.productCount ?? 0;
    const total = rows.length;
    const example = rows.map((row) => (row[header] ?? "").trim()).find(Boolean) ?? null;
    const base = {
      sourceColumn: header, filled, total, distinct: profile?.distinctCount ?? 0,
      example: example && example.length > EXAMPLE_LENGTH ? `${example.slice(0, EXAMPLE_LENGTH)}…` : example,
      detected: profile ? kindOf(profile) : "empty" as ImportColumnKind,
      notes: profile ? notesFor(profile, total) : [],
    };
    if (recognized.has(header)) return { ...base, status: "standard" as const, suggestion: null };
    if (filled === 0) return { ...base, status: "empty" as const, notes: ["Colonne vide : rien à importer."], suggestion: null };
    const baseKey = isAmbiguousHeader(header) ? null : attributeKeyFromHeader(header);
    if (!baseKey) {
      return { ...base, status: "unrecognized" as const, suggestion: null,
        notes: [...base.notes, isAmbiguousHeader(header) ? "Impossible de deviner s'il s'agit de l'image ou du lien d'achat : choisissez la destination." : "Nom de colonne inexploitable : choisissez la destination."] };
    }
    if (attributeCount >= MAX_ATTRIBUTE_COLUMNS) {
      return { ...base, status: "unrecognized" as const, suggestion: null, notes: [...base.notes, `${MAX_ATTRIBUTE_COLUMNS} informations supplémentaires au maximum : colonne non proposée.`] };
    }
    const free = freeAttributeKey(baseKey, taken);
    if (!free) return { ...base, status: "unrecognized" as const, suggestion: null };
    taken.add(free.key);
    attributeCount++;
    return {
      ...base, status: "suggested" as const,
      suggestion: { targetField: `attribute.${free.key}`, key: free.key, recommended: !!profile?.usable, renamed: free.renamed },
    };
  });
}
