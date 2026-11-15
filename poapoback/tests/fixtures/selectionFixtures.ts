/**
 * Fixtures du lot 10D : catalogues SYNTHÉTIQUES à valeurs pseudo-aléatoires reproductibles (graine fixe) et à dépendances
 * réalistes (la fraîcheur dépend un peu de la famille, le prix de la marque…). Les fixtures du lot 10B suivent des motifs
 * modulo : plusieurs colonnes y sont des fonctions l'une de l'autre, ce qui n'est pas représentatif d'un vrai catalogue.
 * Aucune n'est issue du lot 9 : leurs résultats ne sont pas comparables au lot 9.
 */
import type { SelectableProduct } from "../../src/services/criteriaSelection";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const weighted = <T,>(r: Rng, list: readonly [T, number][]): T => {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [value, w] of list) { x -= w; if (x <= 0) return value; }
  return list[list.length - 1][0];
};
const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
const pid = (prefix: string, i: number) => `${prefix}${String(i + 1).padStart(4, "0")}`;

export function perfumeSeeded(count = 40, seed = 101): SelectableProduct[] {
  const r = rng(seed);
  const families = { Floral: [0.5, 0.4, 0.1], Boisé: [0.3, 0.6, 0.0], Oriental: [0.2, 0.2, 0.7], Frais: [0.85, 0.1, 0.0], Gourmand: [0.3, 0.2, 0.9], Fougère: [0.55, 0.2, 0.0] } as const;
  const lines = { Floral: "Fleurs", Boisé: "Bois", Oriental: "Orient", Frais: "Eaux", Gourmand: "Sucré", Fougère: "Herbes" } as const;
  const brands = [["Maison Aube", 1.3], ["Atelier Nord", 1.0], ["Essences Sud", 0.8], ["Orée", 1.6], ["Brume", 0.9], ["Mistral", 1.1]] as const;
  const tags = ["eau de parfum", "eau de toilette", "vanille", "agrumes", "santal", "iris", "ambre", "musc"];
  return Array.from({ length: count }, (_, i) => {
    const family = pick(r, Object.keys(families) as (keyof typeof families)[]);
    const [fresh, woody, sweet] = families[family];
    const [brand, tier] = pick(r, brands);
    return {
      id: pid("prf", i), brand, price: Math.round(35 + tier * 40 + r() * 45), tags: [pick(r, tags), pick(r, tags)].filter((t, k, a) => a.indexOf(t) === k),
      attributes: {
        genre: weighted(r, [["Femme", 4], ["Homme", 3.5], ["Mixte", 2.5]]), famille: family, ligne: lines[family],
        freshness: clamp01(fresh + (r() - 0.5) * 0.4), woody: clamp01(woody + (r() - 0.5) * 0.4), sweetness: clamp01(sweet + (r() - 0.5) * 0.4), intensity: clamp01(r()),
        contenance: pick(r, [30, 50, 100]), vegan: r() < 0.4, sku: 3_760_000_000_000 + Math.floor(r() * 1e9),
      },
    };
  });
}

export function coffeeSeeded(count = 24, seed = 202): SelectableProduct[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const origin = pick(r, ["Éthiopie", "Colombie", "Brésil", "Kenya", "Guatemala"] as const);
    const acid = { Éthiopie: 0.8, Colombie: 0.55, Brésil: 0.25, Kenya: 0.9, Guatemala: 0.5 }[origin];
    return {
      id: pid("caf", i), brand: pick(r, ["Torréfacteur A", "Torréfacteur B", "Torréfacteur C"]), price: Math.round((6 + r() * 14) * 100) / 100,
      tags: r() < 0.7 ? [pick(r, ["fruité", "chocolat", "noisette", "épicé"])] : [],
      attributes: {
        origine: origin, type: weighted(r, [["Grains", 5], ["Moulu", 3], ["Capsules", 2]]), torrefaction: pick(r, ["Légère", "Moyenne", "Foncée"]),
        acidity: clamp01(acid + (r() - 0.5) * 0.3), intensity: clamp01(r()), poids_g: pick(r, [250, 500, 1000]), bio: r() < 0.5,
      },
    };
  });
}

export function fashionSeeded(count = 30, seed = 303): SelectableProduct[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const category = pick(r, ["Robe", "Veste", "Pantalon", "Chemise", "Pull"] as const);
    const base = { Robe: 70, Veste: 120, Pantalon: 80, Chemise: 55, Pull: 65 }[category];
    return {
      id: pid("mod", i), brand: pick(r, ["Studio 12", "Maille & Fils", "Atelier Rue"]), price: Math.round(base * (0.7 + r() * 0.8)),
      tags: [pick(r, ["casual", "chic", "été", "hiver", "basique"])],
      attributes: {
        categorie: category, couleur: pick(r, ["Noir", "Blanc", "Bleu marine", "Beige", "Vert", "Rouge"]),
        matiere: weighted(r, [["Coton", 4], ["Laine", 2], ["Lin", 2], ["Polyester", 2]]), taille: pick(r, ["S", "M", "L", "XL"]), confort: clamp01(r()),
      },
    };
  });
}

/** Catalogue sans aucun critère de choix : identifiants, valeur constante, texte libre, mono-valeur. */
export function noUsefulCriteria(count = 30): SelectableProduct[] {
  return Array.from({ length: count }, (_, i) => ({
    id: pid("nul", i), brand: "Marque unique", price: null, tags: [],
    attributes: { ref: `R-${1000 + i}`, pays: "France", notes: `Texte libre assez long pour ne jamais être une catégorie, numéro ${i} dans le fichier.`, fournisseur: ["F1", "F2"][i % 2], code: 7_000_000_000 + i },
  }));
}
