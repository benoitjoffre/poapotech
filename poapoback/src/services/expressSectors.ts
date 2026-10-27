import type { ExpressSector } from "@poapo/types";

/** Modèles sectoriels de la création express. Ils décrivent des critères et des questions, jamais des valeurs produit. */

export interface AxisTemplate {
  /** Clé canonique, utilisée seulement si aucun attribut produit équivalent n'existe. */
  key: string;
  /** Noms d'attributs produit équivalents, comparés sans accents ni séparateurs. */
  aliases: string[];
  label: string;
  description: string;
  lowLabel: string;
  highLabel: string;
}

export interface QuestionTemplate {
  text: string;
  /** Impacts exprimés en clés canoniques ; ils sont remappés sur les clés réelles des axes. */
  answers: { text: string; emoji: string; impacts: Record<string, number> }[];
}

export interface SectorTemplate {
  id: ExpressSector;
  label: string;
  /** Mots-clés (sans accents, en minuscules) cherchés dans l'activité, le catalogue et les produits. */
  keywords: RegExp;
  quizTitle: string;
  axes: AxisTemplate[];
  questions: QuestionTemplate[];
}

const S = 0.25;
const L = 0.15;

function axis(key: string, aliases: string[], label: string, description: string, lowLabel: string, highLabel: string): AxisTemplate {
  return { key, aliases: [key, ...aliases], label, description, lowLabel, highLabel };
}

function single(text: string, key: string, lowText: string, lowEmoji: string, highText: string, highEmoji: string): QuestionTemplate {
  return { text, answers: [{ text: lowText, emoji: lowEmoji, impacts: { [key]: -S } }, { text: highText, emoji: highEmoji, impacts: { [key]: S } }] };
}

function scenario(text: string, answers: [string, string, Record<string, number>][]): QuestionTemplate {
  return { text, answers: answers.map(([answer, emoji, impacts]) => ({ text: answer, emoji, impacts })) };
}

export const SECTORS: SectorTemplate[] = [
  {
    id: "coffee",
    label: "Café",
    keywords: /\b(cafes?|espresso|arabica|robusta|torrefaction|torrefacteur|grains?|moulu)\b/g,
    quizTitle: "Trouvez le café qui vous ressemble",
    axes: [
      axis("intensity", ["intensite", "force"], "Intensité", "Puissance du café en tasse.", "Léger", "Corsé"),
      axis("acidity", ["acidite", "vivacite"], "Acidité", "Vivacité et notes fruitées en bouche.", "Rond", "Vif"),
      axis("body", ["corps", "rondeur", "texture"], "Corps", "Texture et longueur en bouche.", "Fluide", "Ample"),
      axis("sweetness", ["douceur", "sucrosite"], "Douceur", "Présence de notes sucrées (caramel, chocolat).", "Amer", "Doux"),
    ],
    questions: [
      single("Comment aimez-vous votre café au réveil ?", "intensity", "Léger et facile à boire", "☕", "Corsé, bien noir", "💪"),
      single("Une pointe de vivacité dans la tasse ?", "acidity", "Non, rond et sans acidité", "🍫", "Oui, des notes fruitées et vives", "🍋"),
      single("Quelle texture en bouche ?", "body", "Fluide et délicate", "💧", "Ample, qui tient en bouche", "🫖"),
      single("Côté saveurs, vous êtes plutôt…", "sweetness", "Amer et tranché", "🖤", "Doux, avec des notes sucrées", "🍯"),
      scenario("Quel moment pour votre café ?", [
        ["Le réveil énergique", "🌅", { intensity: L, body: 0.1 }],
        ["La pause gourmande", "🍪", { sweetness: L, intensity: -0.1 }],
        ["Une dégustation curieuse", "🔍", { acidity: L, body: -0.1 }],
      ]),
      scenario("Comment le buvez-vous ?", [
        ["Noir, sans sucre", "⚫", { intensity: 0.1, sweetness: -L }],
        ["Avec un nuage de lait", "🥛", { intensity: -0.1, sweetness: L }],
        ["En espresso serré", "⚡", { intensity: L, body: L }],
        ["En filtre, bien long", "🫗", { acidity: L, body: -0.1 }],
      ]),
      scenario("Quelle ambiance de saveurs vous attire ?", [
        ["Fruits rouges et agrumes", "🍓", { acidity: 0.2, body: -0.1 }],
        ["Chocolat et noisette", "🌰", { sweetness: L, body: L }],
        ["Boisé et épicé", "🌲", { intensity: L, acidity: -L }],
      ]),
    ],
  },
  {
    id: "perfume",
    label: "Parfum",
    keywords: /\b(parfums?|eau de (toilette|parfum)|fragrances?|cologne|musc|sillage)\b/g,
    quizTitle: "Trouvez le parfum qui vous ressemble",
    axes: [
      axis("freshness", ["fraicheur", "frais"], "Fraîcheur", "Sensation fraîche, aérienne ou chaude du parfum.", "Chaleureux", "Frais"),
      axis("intensity", ["intensite", "sillage", "puissance"], "Intensité", "Présence et sillage du parfum.", "Discret", "Puissant"),
      axis("sweetness", ["douceur", "gourmand", "gourmandise"], "Douceur", "Notes sucrées, vanillées ou gourmandes.", "Sec", "Gourmand"),
      axis("woody", ["boise", "boisee", "bois", "caractereboise"], "Caractère boisé", "Présence de notes de bois (cèdre, santal).", "Peu boisé", "Très boisé"),
    ],
    questions: [
      single("Quelle sensation recherchez-vous en vaporisant ?", "freshness", "Chaude et enveloppante", "🔥", "Fraîche et vive", "💧"),
      single("Quel sillage souhaitez-vous ?", "intensity", "Discret, de près", "🤫", "Présent, qui se remarque", "✨"),
      single("Côté douceur ?", "sweetness", "Sec, peu sucré", "🌿", "Gourmand, vanillé", "🍦"),
      single("Les notes de bois vous parlent-elles ?", "woody", "Plutôt floral ou fruité", "🌸", "Oui, boisé (cèdre, santal)", "🪵"),
      scenario("Pour quelle occasion ?", [
        ["Au bureau, au quotidien", "💼", { intensity: -L, freshness: 0.1 }],
        ["Une soirée", "🌙", { intensity: 0.2, sweetness: 0.1 }],
        ["Un week-end nature", "🏞️", { woody: 0.2, freshness: 0.1 }],
      ]),
      scenario("Quelle saison vous inspire ?", [
        ["L'été", "☀️", { freshness: 0.2, sweetness: -0.1 }],
        ["L'hiver", "❄️", { freshness: -0.2, sweetness: 0.1, woody: 0.1 }],
        ["La mi-saison", "🍂", { woody: 0.1, intensity: -0.05 }],
      ]),
      scenario("Votre signature olfactive ?", [
        ["Propre et lumineuse", "🫧", { freshness: 0.2, woody: -0.1 }],
        ["Sensuelle et ambrée", "🌹", { sweetness: L, intensity: L }],
        ["Boisée et élégante", "🎩", { woody: 0.2, intensity: 0.1 }],
      ]),
    ],
  },
  {
    id: "travel",
    label: "Voyage",
    keywords: /\b(voyages?|sejours?|treks?|randonnees?|croisieres?|destinations?|circuits?|hotels?|vacances)\b/g,
    quizTitle: "Trouvez le voyage qui vous ressemble",
    axes: [
      axis("adventure", ["aventure", "aventurier"], "Aventure", "Goût de l'inconnu et de l'effort.", "Tranquille", "Aventureux"),
      axis("relaxation", ["detente", "repos", "relax", "bienetre"], "Détente", "Besoin de repos et de ressourcement.", "Actif", "Reposant"),
      axis("culture", ["culturel", "patrimoine"], "Culture", "Place des visites, de l'histoire et du patrimoine.", "Peu culturel", "Très culturel"),
      axis("nature", ["naturel", "paysage"], "Nature", "Immersion dans les grands espaces.", "Urbain", "Nature"),
    ],
    questions: [
      single("Quel est votre rythme de voyage ?", "adventure", "Je prends mon temps, sans programme", "🐢", "Je pars à la découverte de l'inconnu", "🧭"),
      single("Qu'attendez-vous de vos vacances ?", "relaxation", "Rester actif", "🏃", "Me ressourcer totalement", "🧘"),
      single("Quelle place pour la culture ?", "culture", "Peu, j'y vais pour autre chose", "🏖️", "Musées, histoire, patrimoine", "🏛️"),
      single("Dans quel décor ?", "nature", "Plutôt ville et animation", "🏙️", "Montagne, mer, grands espaces", "🏔️"),
      scenario("Le voyage idéal ?", [
        ["Un trek sac au dos", "🥾", { adventure: 0.2, nature: L, relaxation: -0.1 }],
        ["Une semaine sur la plage", "🏝️", { relaxation: 0.2, adventure: -0.1 }],
        ["Un city trip", "🚆", { culture: 0.2, nature: -L }],
        ["Un séjour bien-être", "🛁", { relaxation: L, nature: 0.1 }],
      ]),
      scenario("Votre première journée sur place ?", [
        ["Je pars explorer", "🗺️", { adventure: L, culture: 0.1 }],
        ["Je profite de l'hébergement", "🛌", { relaxation: 0.2, adventure: -0.1 }],
        ["Je visite le centre historique", "⛪", { culture: 0.2 }],
        ["Je file en pleine nature", "🌲", { nature: 0.2 }],
      ]),
      scenario("Quel souvenir voulez-vous rapporter ?", [
        ["Une anecdote improbable", "🎒", { adventure: L, relaxation: -0.05 }],
        ["Une vraie pause", "😌", { relaxation: L, adventure: -0.1 }],
        ["Un lieu chargé d'histoire", "📜", { culture: L, nature: -0.05 }],
      ]),
    ],
  },
  {
    id: "fashion",
    label: "Mode",
    keywords: /\b(mode|vetements?|robes?|vestes?|chemises?|pantalons?|chaussures?|sneakers?|manteaux?|pulls?|jeans?|pret-a-porter)\b/g,
    quizTitle: "Trouvez le style qui vous ressemble",
    axes: [
      axis("elegance", ["elegant", "chic", "classe"], "Élégance", "Allure soignée et habillée.", "Naturel", "Élégant"),
      axis("comfort", ["confort", "confortable"], "Confort", "Aisance et souplesse portées.", "Ajusté", "Très confortable"),
      axis("originality", ["originalite", "original", "audace"], "Originalité", "Pièces qui se remarquent.", "Classique", "Original"),
      axis("casual", ["decontracte", "streetwear"], "Casual", "Style décontracté du quotidien.", "Habillé", "Décontracté"),
    ],
    questions: [
      single("Votre allure préférée ?", "elegance", "Naturelle, sans apprêt", "🌿", "Chic et soignée", "🎩"),
      single("Qu'est-ce qui compte le plus dans un vêtement ?", "comfort", "Le tombé, même moins souple", "📐", "Être à l'aise avant tout", "🛋️"),
      single("Face à la tendance ?", "originality", "Un classique intemporel", "🕰️", "Une pièce qui se remarque", "🌈"),
      single("Pour le quotidien ?", "casual", "Habillé, même en semaine", "👔", "Décontracté, jean-baskets", "👟"),
      scenario("Pour sortir ce week-end ?", [
        ["Un brunch entre amis", "🥐", { casual: 0.2, comfort: 0.1 }],
        ["Un dîner élégant", "🍷", { elegance: S, casual: -L }],
        ["Une soirée originale", "🎉", { originality: 0.2, elegance: 0.05 }],
      ]),
      scenario("Au bureau ?", [
        ["Costume ou tailleur impeccable", "💼", { elegance: 0.2, comfort: -0.1 }],
        ["Smart casual confortable", "👕", { comfort: L, casual: 0.1 }],
        ["Une touche d'audace", "🧣", { originality: L, elegance: 0.05 }],
      ]),
      scenario("Votre pièce fétiche ?", [
        ["Un basique doux et souple", "🧶", { comfort: 0.2, originality: -0.1 }],
        ["Une pièce signature", "💎", { originality: 0.2, casual: -0.05 }],
        ["Une veste ou un blazer", "🧥", { elegance: 0.2 }],
      ]),
    ],
  },
];

export function sectorById(id: unknown): SectorTemplate | null {
  return SECTORS.find((sector) => sector.id === id) ?? null;
}
