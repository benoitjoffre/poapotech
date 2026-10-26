/** « Niveau de torréfaction » → « niveauDeTorrefaction » */
export function axisKeyFromLabel(label: string): string {
  const words = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .replace(/^[0-9]+/, "");
  return key.slice(0, 40);
}
