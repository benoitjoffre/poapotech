/** Séparateur d'un CSV : celui (`;`, `,` ou tabulation) le plus présent hors guillemets dans la ligne d'en-tête. Excel en français produit `;`. */
export function detectCsvSeparator(buffer: Buffer): string {
  const header = buffer.toString("utf8").replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ",";
}
