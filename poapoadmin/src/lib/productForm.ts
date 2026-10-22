import type { Product, ProductAttributes, ProductCreateInput, Quiz, QuizAxis } from "@poapo/types";

export interface ProductFormState {
  name: string;
  brand: string;
  description: string;
  price: string;
  imageUrl: string;
  purchaseUrl: string;
  tags: string;
  active: boolean;
  featured: boolean;
  /** Valeurs des axes de recommandation (0–1), "" = non renseigné. */
  axisValues: Record<string, string>;
  /** Autres caractéristiques libres, au format objet JSON. */
  attributes: string;
}

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "",
  brand: "",
  description: "",
  price: "",
  imageUrl: "",
  purchaseUrl: "",
  tags: "",
  active: true,
  featured: false,
  axisValues: {},
  attributes: "{}",
};

/** Union des axes de tous les quiz : le catalogue est partagé entre quiz. */
export function collectAxes(quizzes: Quiz[]): QuizAxis[] {
  const byKey = new Map<string, QuizAxis>();
  for (const quiz of quizzes) {
    for (const axis of quiz.axes ?? []) if (!byKey.has(axis.key)) byKey.set(axis.key, axis);
  }
  return [...byKey.values()];
}

function commaToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFloat01(value: string): number | null {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
}

export function productToForm(product: Product, axes: QuizAxis[]): ProductFormState {
  const attributes = { ...(product.attributes ?? {}) };
  const axisValues: Record<string, string> = {};
  for (const axis of axes) {
    const value = attributes[axis.key];
    if (typeof value === "number") {
      axisValues[axis.key] = String(value);
      delete attributes[axis.key];
    }
  }
  return {
    name: product.name,
    brand: product.brand ?? "",
    description: product.description ?? "",
    price: product.price != null ? String(product.price) : "",
    imageUrl: product.imageUrl ?? "",
    purchaseUrl: product.purchaseUrl ?? "",
    tags: product.tags.join(", "),
    active: product.active,
    featured: product.featured,
    axisValues,
    attributes: JSON.stringify(attributes, null, 2),
  };
}

/** Construit le payload API ; lève une erreur si le JSON des attributs est invalide. */
export function formToPayload(form: ProductFormState): ProductCreateInput {
  let extra: unknown;
  try {
    extra = JSON.parse(form.attributes.trim() || "{}");
  } catch {
    throw new Error("Les caractéristiques complémentaires doivent être un objet JSON valide.");
  }
  if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
    throw new Error("Les caractéristiques complémentaires doivent être un objet JSON.");
  }
  const attributes: ProductAttributes = { ...(extra as ProductAttributes) };
  for (const [key, raw] of Object.entries(form.axisValues)) {
    const value = parseFloat01(raw);
    if (value === null) delete attributes[key];
    else attributes[key] = value;
  }
  return {
    name: form.name.trim(),
    brand: form.brand || null,
    description: form.description || null,
    price: form.price ? parseFloat(form.price) : null,
    imageUrl: form.imageUrl || null,
    purchaseUrl: form.purchaseUrl || null,
    tags: commaToArray(form.tags),
    active: form.active,
    featured: form.featured,
    attributes,
  };
}
