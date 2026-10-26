import type { QuizAxis } from "@poapo/types";

export interface FieldMapping {
  sourceColumn: string;
  targetField: string | null;
  /** Proposée automatiquement par la reconnaissance locale des colonnes. */
  auto?: boolean;
}

export interface ImportIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ImportPreview {
  total: number;
  valid: number;
  invalid: number;
  warningRows: number;
  canImport: boolean;
  mappingIssues: ImportIssue[];
  issues: (ImportIssue & { line: number })[];
  issuesTruncated: boolean;
  sample: { line: number; product: Record<string, unknown> }[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  embeddings?: "queued" | "unavailable" | "none";
}

export const PRODUCT_TARGETS = [
  { value: "name", label: "Nom (obligatoire)" },
  { value: "brand", label: "Marque" },
  { value: "description", label: "Description" },
  { value: "price", label: "Prix" },
  { value: "imageUrl", label: "URL de l'image" },
  { value: "purchaseUrl", label: "URL d'achat" },
  { value: "tags", label: "Tags (séparés par , ; ou |)" },
  { value: "active", label: "Actif (oui / non)" },
  { value: "featured", label: "Mis en avant (oui / non)" },
  { value: "attributes", label: "Caractéristiques (objet JSON)" },
] as const;

export type DestinationKind = "ignored" | "product" | "axis" | "attribute";

export function destinationKind(target: string | null, axes: readonly QuizAxis[]): DestinationKind {
  if (!target) return "ignored";
  if (!target.startsWith("attribute.")) return "product";
  return axes.some((axis) => `attribute.${axis.key}` === target) ? "axis" : "attribute";
}

export function destinationLabel(target: string | null, axes: readonly QuizAxis[]): string {
  if (!target) return "Ignorée";
  const product = PRODUCT_TARGETS.find((t) => t.value === target);
  if (product) return product.label;
  const key = target.slice("attribute.".length);
  const axis = axes.find((a) => a.key === key);
  return axis ? `Axe : ${axis.label}` : `Attribut : ${key}`;
}

/** Destinations choisies plusieurs fois (hors « Ignorée »). */
export function duplicateTargets(mapping: readonly FieldMapping[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { targetField } of mapping) {
    if (!targetField) continue;
    if (seen.has(targetField)) dup.add(targetField);
    seen.add(targetField);
  }
  return dup;
}

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Exemple CSV construit à partir des axes réels du catalogue : une colonne par axe, valeurs 0–1
 * d'illustration. Aucun axe n'est inventé quand le catalogue n'en a pas.
 */
export function exampleCsv(axes: readonly QuizAxis[]): string {
  const headers = ["Nom", "Marque", "Description", "Prix", "URL achat", "URL image", ...axes.map((a) => a.label)];
  const sampleValues = ["0.2", "0.5", "0.8"];
  const rows = [1, 2, 3].map((n) => [
    `Exemple produit ${n}`, "Ma marque", "Courte description", `${10 + n * 5}`, "https://exemple.fr/produit", "https://exemple.fr/image.jpg",
    ...axes.map((_, i) => sampleValues[(i + n) % sampleValues.length]),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
