export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Value of the data-tour attribute to highlight. Absent or missing in the DOM: centered informative card. */
  target?: string;
  points?: string[];
  note?: string;
}

export const MAIN_TOUR_STEPS: TourStep[] = [
  { id: "home", title: "Accueil", target: "nav-home",
    body: "Découvrez votre espace et les principales fonctionnalités de POAPO." },
  { id: "products", title: "Mes produits", target: "nav-products",
    body: "Ajoutez les produits que vous souhaitez recommander à vos visiteurs." },
  { id: "experiences", title: "Mes expériences", target: "nav-experiences",
    body: "Créez un quiz qui aide vos visiteurs à trouver les produits qui leur correspondent." },
  { id: "editor", title: "Éditeur de questions",
    body: "Ajoutez des questions, configurez les réponses et indiquez leur influence sur les recommandations avec le curseur.",
    points: [
      "Chaque question propose plusieurs réponses.",
      "Chaque réponse oriente les recommandations vers certains produits.",
    ],
    note: "Cette visite ne crée ni ne modifie aucun quiz." },
  { id: "publication", title: "Publication",
    body: "Essayez votre quiz, vérifiez les recommandations puis publiez-le pour le rendre accessible à vos visiteurs.",
    points: [
      "Enregistrer conserve votre brouillon sans changer ce que voit le public.",
      "Publier remplace la version vue par le public par votre dernier brouillon enregistré.",
      "L'accès public décide si vos visiteurs peuvent ouvrir le quiz via son lien ou le widget.",
    ],
    note: "Cette visite ne publie ni n'active aucun quiz." },
  { id: "results", title: "Résultats", target: "nav-results",
    body: "Découvrez combien de fois vos quiz sont utilisés et quels produits intéressent vos visiteurs.",
    note: "Ces chiffres mesurent l'usage de vos quiz, pas vos ventes." },
];
