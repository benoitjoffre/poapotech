import type { JsonValue, ProductAttributes, QuizAxis } from "@poapo/types";

export const AXIS_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_AXES = 12;

export class AxisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxisValidationError";
  }
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AxisValidationError(`Le champ ${field} d'un axe doit être un texte`);
  return value.trim() || null;
}

/** Valide et normalise une définition d'axes envoyée par l'admin. */
export function validateAxes(raw: unknown): QuizAxis[] {
  if (!Array.isArray(raw)) throw new AxisValidationError("axes doit être une liste");
  if (raw.length > MAX_AXES) throw new AxisValidationError(`${MAX_AXES} axes maximum par quiz`);

  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AxisValidationError("Chaque axe doit être un objet { key, label }");
    }
    const axis = item as Record<string, unknown>;
    const key = typeof axis.key === "string" ? axis.key.trim() : "";
    const label = typeof axis.label === "string" ? axis.label.trim() : "";
    if (!AXIS_KEY_PATTERN.test(key)) {
      throw new AxisValidationError(
        `Clé d'axe invalide « ${key} » : lettres, chiffres et _ uniquement, commençant par une lettre`,
      );
    }
    if (seen.has(key)) throw new AxisValidationError(`Clé d'axe en double : ${key}`);
    if (!label) throw new AxisValidationError(`Le libellé de l'axe ${key} est requis`);
    seen.add(key);
    return {
      key,
      label,
      lowLabel: optionalText(axis.lowLabel, "lowLabel"),
      highLabel: optionalText(axis.highLabel, "highLabel"),
    };
  });
}

/** Lit des axes stockés en base en ignorant les entrées malformées. */
export function parseAxes(raw: unknown): QuizAxis[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const axis = item as Record<string, unknown>;
    if (typeof axis.key !== "string" || !axis.key) return [];
    return [{
      key: axis.key,
      label: typeof axis.label === "string" && axis.label ? axis.label : axis.key,
      lowLabel: typeof axis.lowLabel === "string" ? axis.lowLabel : null,
      highLabel: typeof axis.highLabel === "string" ? axis.highLabel : null,
    }];
  });
}

export function isAxisValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isProductAttributes(value: unknown): value is ProductAttributes {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Renvoie la première clé d'axe dont la valeur produit n'est pas un nombre entre 0 et 1. */
export function invalidAxisValue(attributes: Record<string, JsonValue | unknown>, axisKeys: Iterable<string>): string | null {
  for (const key of axisKeys) {
    if (key in attributes && attributes[key] !== null && !isAxisValue(attributes[key])) return key;
  }
  return null;
}
