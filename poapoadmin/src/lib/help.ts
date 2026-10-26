import type { HelpArticle, HelpFaq } from "./helpTypes";
import { GUIDE_PRODUCTS, GUIDE_EXPERIENCE, GUIDE_QUESTIONS } from "./helpArticlesA";
import { GUIDE_PUBLISH, GUIDE_INTEGRATE, GUIDE_RESULTS } from "./helpArticlesB";

export const HELP_ARTICLES: readonly HelpArticle[] = [
  GUIDE_PRODUCTS, GUIDE_EXPERIENCE, GUIDE_QUESTIONS, GUIDE_PUBLISH, GUIDE_INTEGRATE, GUIDE_RESULTS,
];

export const HELP_CATEGORIES = ["Catalogue", "Expérience", "Publication", "Intégration", "Résultats"] as const;

export const HELP_FAQ: readonly HelpFaq[] = [
  { question: "Puis-je créer plusieurs expériences ?", answer: "Oui. Vous pouvez créer autant d'expériences que nécessaire, par exemple une par gamme de produits.", slug: "creer-une-experience" },
  { question: "Puis-je utiliser une expérience dans plusieurs campagnes ?", answer: "Oui. Plusieurs campagnes peuvent partager la même expérience ; une publication vous demande alors de confirmer que toutes recevront la nouvelle version.", slug: "tester-et-publier" },
  { question: "Mes produits sont-ils modifiés lorsque je publie un quiz ?", answer: "Non. La publication remplace la version publique du quiz (questions, préférences, apparence) mais ne modifie pas vos produits.", slug: "tester-et-publier" },
  { question: "Une campagne programmée rend-elle automatiquement mon quiz accessible ?", answer: "Non. L'accessibilité dépend de l'état actif de l'expérience et de la boutique ; une campagne ne la modifie pas.", slug: "tester-et-publier" },
  { question: "Comment partager mon expérience ?", answer: "Une fois le quiz publié et accessible, partagez son lien public ou ajoutez le code d'intégration sur votre site.", slug: "integrer-sur-votre-site" },
  { question: "Les clics produits représentent-ils des ventes ?", answer: "Non. Un clic indique qu'un visiteur s'est intéressé à un produit ; POAPO ne mesure pas les achats.", slug: "comprendre-vos-resultats" },
];

export const findArticle = (slug: string | undefined) => HELP_ARTICLES.find((a) => a.slug === slug);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function haystack(a: HelpArticle): string {
  return norm([
    a.title, a.summary, a.category, a.intro,
    ...a.steps.flatMap((s) => [s.title, s.body]),
    ...(a.sections ?? []).flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.items ?? [])]),
    ...a.tips,
  ].join(" "));
}

/** Tous les mots saisis doivent apparaître dans le titre ou le contenu de l'article. */
export function searchArticles(query: string): HelpArticle[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...HELP_ARTICLES];
  return HELP_ARTICLES.filter((a) => { const h = haystack(a); return words.every((w) => h.includes(w)); });
}

export function searchFaq(query: string): HelpFaq[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return HELP_FAQ.filter((f) => words.every((w) => norm(`${f.question} ${f.answer}`).includes(w)));
}
