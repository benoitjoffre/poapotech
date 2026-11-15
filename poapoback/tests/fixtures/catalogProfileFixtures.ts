/**
 * Fixtures du lot 10B. IMPORTANT : ce sont de NOUVELLES fixtures synthétiques (les fixtures du lot 9 ne sont pas
 * dans le dépôt). Leurs résultats ne sont PAS comparables à ceux du lot 9.
 * Construction 100 % déterministe (aucun hasard, aucune date) : les mêmes données à chaque exécution.
 */
import type { ExpressContext, ExpressProduct } from "../../src/services/expressQuiz";

const pick = <T,>(list: readonly T[], i: number): T => list[i % list.length];
const id = (prefix: string, i: number) => `${prefix}${String(i + 1).padStart(3, "0")}`;
const unit = (i: number, step: number, offset: number) => Math.round((((i * step + offset) % 100) / 100) * 100) / 100;

function make(
  prefix: string, i: number, name: string,
  fields: { brand?: string | null; price?: number | null; tags?: string[]; attributes?: Record<string, unknown> },
): ExpressProduct {
  return {
    id: id(prefix, i), name, brand: fields.brand ?? null, price: fields.price ?? null,
    description: `Description de ${name}`, tags: fields.tags ?? [], attributes: fields.attributes ?? {}, embeddingReady: false,
  };
}

function ctx(catalogName: string, industry: string, products: ExpressProduct[]): ExpressContext {
  return { catalogId: `cat-${catalogName}`, catalogName, catalogDescription: null, industry, products, existingAxes: [] };
}

// ─── Parfum : 40 produits ─────────────────────────────────────────────────────
const GENRES = ["Femme", "Homme", "Mixte"] as const;
const FAMILLES = ["Floral", "Boisé", "Oriental", "Frais", "Gourmand", "Fougère"] as const;
const PERFUME_BRANDS = ["Maison Aube", "Atelier Nord", "Essences Sud", "Parfums Lys", "Orée", "Brume", "Ciel d'Encre", "Mistral"] as const;
const PERFUME_TAGS = ["eau de parfum", "eau de toilette", "vanille", "agrumes", "bois de santal", "iris", "ambre", "musc"] as const;

export function perfumeCatalog(): ExpressContext {
  const products = Array.from({ length: 40 }, (_, i) => make("prf", i, `Parfum ${pick(FAMILLES, i)} n°${i + 1}`, {
    brand: pick(PERFUME_BRANDS, i * 3 + 1),
    price: 39 + ((i * 17) % 127),
    tags: [pick(PERFUME_TAGS, i), pick(PERFUME_TAGS, i + 3 + (i % 2))],
    attributes: {
      genre: pick(GENRES, i * 5 + 2),
      famille: pick(FAMILLES, i * 7 + 1),
      freshness: unit(i, 13, 5), intensity: unit(i, 29, 11), sweetness: unit(i, 41, 3), woody: unit(i, 17, 23),
      contenance: pick([30, 50, 100], i * 2 + 1),
      vegan: i % 3 !== 0,
      sku: 3_760_000_000_000 + i * 7,
    },
  }));
  return ctx("Parfums", "Parfumerie", products);
}

// ─── Café : 24 produits ───────────────────────────────────────────────────────
const ORIGINES = ["Éthiopie", "Colombie", "Brésil", "Kenya", "Guatemala"] as const;
const COFFEE_TYPES = ["Grains", "Moulu", "Capsules"] as const;
const TORREFACTIONS = ["Légère", "Moyenne", "Foncée"] as const;

export function coffeeCatalog(): ExpressContext {
  const products = Array.from({ length: 24 }, (_, i) => make("caf", i, `Café ${pick(ORIGINES, i * 2)} lot ${i + 1}`, {
    brand: pick(["Torréfacteur A", "Torréfacteur B", "Torréfacteur C"], i),
    price: Math.round((6.5 + (i % 9) * 1.75) * 100) / 100,
    tags: i % 4 === 0 ? [] : [pick(["fruité", "chocolat", "noisette", "épicé"], i)],
    attributes: {
      origine: pick(ORIGINES, i * 2),
      type: pick(COFFEE_TYPES, i * 5 + 1),
      torrefaction: pick(TORREFACTIONS, i * 7 + 2),
      acidity: unit(i, 11, 7), intensity: unit(i, 23, 9),
      poids_g: pick([250, 500, 1000], i + 1),
      bio: i % 2 === 0,
    },
  }));
  return ctx("Cafés", "Café", products);
}

// ─── Mode : 30 produits ───────────────────────────────────────────────────────
const CATEGORIES = ["Robe", "Veste", "Pantalon", "Chemise", "Pull"] as const;
const COULEURS = ["Noir", "Blanc", "Bleu marine", "Beige", "Vert", "Rouge"] as const;
const MATIERES = ["Coton", "Laine", "Lin", "Polyester"] as const;
const TAILLES = ["S", "M", "L", "XL"] as const;

export function fashionCatalog(): ExpressContext {
  const products = Array.from({ length: 30 }, (_, i) => make("mod", i, `${pick(CATEGORIES, i)} ${pick(COULEURS, i * 5 + 1).toLowerCase()} ${i + 1}`, {
    brand: pick(["Studio 12", "Maille & Fils", "Atelier Rue"], i + 2),
    price: 25 + ((i * 23) % 175),
    tags: [pick(["casual", "chic", "été", "hiver", "basique"], i * 3)],
    attributes: {
      categorie: pick(CATEGORIES, i),
      couleur: pick(COULEURS, i * 5 + 1),
      matiere: pick(MATIERES, i * 3 + 2),
      taille: pick(TAILLES, i * 7 + 3),
      confort: unit(i, 19, 4),
    },
  }));
  return ctx("Vêtements", "Mode", products);
}

// ─── Catalogue dégradé : 30 produits ──────────────────────────────────────────
export function degradedCatalog(): ExpressContext {
  const colors = ["Rouge", "rouge ", "ROUGE", "Bleu", "Bleue"];
  const products = Array.from({ length: 30 }, (_, i) => {
    const attributes: Record<string, unknown> = {
      pays: "France",                                           // constante
      statut: i === 7 ? "retiré" : "actif",                     // quasi constante (29/30)
      poids: i % 5 === 0 ? `${250 + i}g` : 250 + (i % 6) * 50,  // 20 % de valeurs invalides
      refInterne: `REF-${1000 + i}`,                            // texte presque unique
      notes: `Une description libre assez longue pour ne surtout pas être traitée comme une catégorie, produit numéro ${i}.`,
      options: i % 4 === 0 ? { a: 1 } : undefined,              // structure imbriquée
      couleur: i < 3 ? colors[i] : i === 3 ? "Bleu" : i === 4 ? "Bleue" : undefined, // 5/30 renseignés, casse incohérente
      score: i % 2 === 0 ? 0.5 : 0.5,                           // numérique constant
      note: i < 12 ? unit(i, 7, 1) : undefined,                 // 12/30 renseignés mais exploitable
    };
    for (const key of Object.keys(attributes)) if (attributes[key] === undefined) delete attributes[key];
    return make("deg", i, `Produit ${i + 1}`, {
      brand: i % 6 === 0 ? "  Marque   X " : i % 6 === 1 ? "marque x" : null,
      price: i === 4 ? -5 : i % 7 === 0 ? null : 10 + i,
      tags: i % 10 === 0 ? ["promo"] : [],
      attributes,
    });
  });
  return ctx("Divers", "", products);
}

export const ALL_FIXTURES = {
  perfume: perfumeCatalog,
  coffee: coffeeCatalog,
  fashion: fashionCatalog,
  degraded: degradedCatalog,
} as const;
