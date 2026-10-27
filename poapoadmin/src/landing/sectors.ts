import cafePhoto from "./assets/sector-cafe.webp";
import parfumPhoto from "./assets/sector-parfum.webp";
import voyagePhoto from "./assets/sector-voyage.webp";
import modePhoto from "./assets/sector-mode.webp";
import demoCafe from "./assets/demo-cafe.webp";

// Univers de démonstration FICTIFS : noms, produits et recommandations n'existent pas. Calcul local, aucun appel réseau,
// indépendant du moteur de recommandation POAPO.
export type SectorId = "cafe" | "parfum" | "voyage" | "mode";

export interface DemoProduct { name: string; blurb: string; tags: string[]; axes: Record<string, number>; photo?: string }
export interface DemoQuestion { text: string; options: { label: string; hint?: string; impacts: Record<string, number> }[] }
export interface Sector {
  id: SectorId; label: string; tagline: string; photo: string; idealLabel: string;
  axes: string[]; questions: DemoQuestion[]; products: DemoProduct[];
}

export const SECTORS: Sector[] = [
  { id: "cafe", label: "Café", tagline: "Des saveurs qui vous ressemblent.", photo: cafePhoto, idealLabel: "Votre café idéal", axes: ["Intensité", "Notes fruitées", "Douceur"],
    questions: [
      { text: "Quel moment de la journée préférez-vous ?", options: [
        { label: "Le matin", hint: "Un réveil tout en énergie", impacts: { intensite: 0.9, douceur: 0.4 } },
        { label: "L'après-midi", hint: "Une pause lente", impacts: { intensite: 0.45, fruite: 0.6, douceur: 0.5 } },
        { label: "Le soir", hint: "Doux et réconfortant", impacts: { intensite: 0.25, douceur: 0.95 } }] },
      { text: "Quelle saveur vous attire le plus ?", options: [
        { label: "Fruits rouges et agrumes", impacts: { fruite: 0.95, intensite: 0.3 } },
        { label: "Chocolat et noisette", impacts: { douceur: 0.7, intensite: 0.6 } },
        { label: "Épices et bois", impacts: { intensite: 0.9, fruite: 0.15 } }] },
      { text: "Comment le préparez-vous ?", options: [
        { label: "Filtre", impacts: { fruite: 0.8, intensite: 0.35 } },
        { label: "Espresso", impacts: { intensite: 0.9, douceur: 0.4 } },
        { label: "Cafetière italienne", impacts: { intensite: 0.65, douceur: 0.6 } }] },
    ],
    products: [
      { name: "L'Équilibré", blurb: "Un café rond et gourmand, parfait pour bien démarrer la journée.", tags: ["Rond", "Chocolaté", "Doux"], axes: { intensite: 0.55, fruite: 0.3, douceur: 0.75 }, photo: demoCafe },
      { name: "Aube Fruitée", blurb: "Notes d'agrumes et de fruits rouges, léger et lumineux.", tags: ["Fruité", "Léger", "Vif"], axes: { intensite: 0.3, fruite: 0.95, douceur: 0.45 }, photo: demoCafe },
      { name: "Nocturne", blurb: "Chocolat noir et noisette grillée, corsé et profond.", tags: ["Corsé", "Boisé", "Intense"], axes: { intensite: 0.9, fruite: 0.1, douceur: 0.45 }, photo: demoCafe },
    ] },
  { id: "parfum", label: "Parfum", tagline: "Le parfum qui révèle votre personnalité.", photo: parfumPhoto, idealLabel: "Votre parfum idéal", axes: ["Fraîcheur", "Sillage", "Boisé"],
    questions: [
      { text: "Dans quelle ambiance voulez-vous vous sentir ?", options: [
        { label: "Un matin au bord de l'eau", impacts: { fraicheur: 0.95, sillage: 0.3 } },
        { label: "Un soir de gala", impacts: { sillage: 0.9, fraicheur: 0.3 } },
        { label: "Une balade en forêt", impacts: { boise: 0.9, sillage: 0.5 } }] },
      { text: "Votre sillage préféré ?", options: [
        { label: "On le devine à peine", impacts: { sillage: 0.1, fraicheur: 0.6 } },
        { label: "Présent mais élégant", impacts: { sillage: 0.55, boise: 0.5 } },
        { label: "Impossible à oublier", impacts: { sillage: 0.95, boise: 0.6 } }] },
    ],
    products: [
      { name: "Eau de Brume", blurb: "Bergamote, sel marin et musc blanc : frais et discret.", tags: ["Frais", "Discret", "Marin"], axes: { fraicheur: 0.95, sillage: 0.25, boise: 0.2 } },
      { name: "Velours Nuit", blurb: "Iris, ambre et vanille noire, un sillage inoubliable.", tags: ["Ambré", "Sillage", "Soir"], axes: { fraicheur: 0.2, sillage: 0.95, boise: 0.5 } },
      { name: "Sous-Bois", blurb: "Cèdre, mousse de chêne et poivre pour les marcheurs.", tags: ["Boisé", "Terreux", "Chaud"], axes: { fraicheur: 0.45, sillage: 0.6, boise: 0.95 } },
    ] },
  { id: "voyage", label: "Voyage", tagline: "Des expériences selon vos envies.", photo: voyagePhoto, idealLabel: "Votre escapade idéale", axes: ["Rythme", "Nature", "Culture"],
    questions: [
      { text: "Votre escapade rêvée ressemble à…", options: [
        { label: "Un hamac et rien à faire", impacts: { rythme: 0.1, nature: 0.6, culture: 0.1 } },
        { label: "Une ville à explorer à pied", impacts: { rythme: 0.5, nature: 0.1, culture: 0.9 } },
        { label: "Un sentier de montagne", impacts: { rythme: 0.9, nature: 0.95, culture: 0.3 } }] },
      { text: "Combien de temps partez-vous ?", options: [
        { label: "Un week-end", impacts: { rythme: 0.6, culture: 0.6 } },
        { label: "Une semaine", impacts: { rythme: 0.5, nature: 0.6 } },
        { label: "Plus, pour décrocher", impacts: { rythme: 0.3, nature: 0.8 } }] },
    ],
    products: [
      { name: "Lagune Tranquille", blurb: "Quatre jours de détente face au lagon.", tags: ["Détente", "Mer", "4 jours"], axes: { rythme: 0.1, nature: 0.7, culture: 0.15 } },
      { name: "Capitale à Pied", blurb: "Week-end musées, marchés et ruelles.", tags: ["Ville", "Culture", "Week-end"], axes: { rythme: 0.5, nature: 0.1, culture: 0.95 } },
      { name: "Haute Traversée", blurb: "Trek de trois jours, refuges inclus.", tags: ["Aventure", "Montagne", "3 jours"], axes: { rythme: 0.95, nature: 0.95, culture: 0.3 } },
    ] },
  { id: "mode", label: "Mode", tagline: "Un style qui vous correspond.", photo: modePhoto, idealLabel: "Votre look idéal", axes: ["Sobriété", "Audace", "Confort"],
    questions: [
      { text: "Comment décririez-vous votre style ?", options: [
        { label: "Épuré, quelques basiques", impacts: { sobriete: 0.95, audace: 0.1 } },
        { label: "Une pièce forte, le reste discret", impacts: { sobriete: 0.5, audace: 0.7 } },
        { label: "Couleurs et volumes", impacts: { sobriete: 0.1, audace: 0.95 } }] },
      { text: "Pour une journée entière, vous choisissez…", options: [
        { label: "Le confort avant tout", impacts: { confort: 0.95 } },
        { label: "Un équilibre", impacts: { confort: 0.5 } },
        { label: "Une coupe nette et structurée", impacts: { confort: 0.15, sobriete: 0.7 } }] },
    ],
    products: [
      { name: "Manteau Ligne", blurb: "Coupe droite, laine douce, sans fioriture.", tags: ["Épuré", "Structuré", "Intemporel"], axes: { sobriete: 0.95, audace: 0.2, confort: 0.5 } },
      { name: "Veste Pigment", blurb: "Volumes généreux et teinte vive.", tags: ["Audacieux", "Couleur", "Ample"], axes: { sobriete: 0.1, audace: 0.95, confort: 0.7 } },
      { name: "Maille Nuage", blurb: "Pull oversize, toucher cocon.", tags: ["Doux", "Confort", "Oversize"], axes: { sobriete: 0.6, audace: 0.3, confort: 0.95 } },
    ] },
];

/** Profil moyen des réponses données, produit de démonstration le plus proche. Sans réponse : produit « équilibré » par défaut. */
export function recommend(sector: Sector, picks: (number | undefined)[]): DemoProduct {
  const sums: Record<string, { s: number; n: number }> = {};
  sector.questions.forEach((q, qi) => {
    const o = picks[qi] === undefined ? undefined : q.options[picks[qi]!];
    for (const [k, v] of Object.entries(o?.impacts ?? {})) { (sums[k] ??= { s: 0, n: 0 }).s += v; sums[k].n += 1; }
  });
  if (!Object.keys(sums).length) return sector.products[0];
  const dist = (p: DemoProduct) => Object.keys(p.axes).reduce((acc, k) => acc + (p.axes[k] - (sums[k] ? sums[k].s / sums[k].n : 0.5)) ** 2, 0);
  return [...sector.products].sort((a, b) => dist(a) - dist(b))[0];
}
