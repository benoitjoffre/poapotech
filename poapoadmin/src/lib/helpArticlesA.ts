import type { HelpArticle } from "./helpTypes";

export const GUIDE_PRODUCTS: HelpArticle = {
  slug: "ajouter-vos-produits",
  number: 1,
  title: "Ajouter vos produits",
  summary: "Importez votre catalogue ou ajoutez vos produits manuellement.",
  minutes: 5,
  category: "Catalogue",
  icon: "box",
  intro: "Les recommandations de POAPO s'appuient sur vos produits. Avant de créer une expérience, rassemblez-les dans un catalogue.",
  sections: [{
    title: "À quoi sert un catalogue ?",
    paragraphs: [
      "Un catalogue est une collection de produits (par exemple « Cafés » ou « Soins visage »). Chaque expérience est reliée à un catalogue : c'est dans celui-ci que POAPO choisit les produits à recommander.",
      "Vous pouvez avoir plusieurs catalogues si vous vendez des gammes très différentes.",
    ],
  }],
  steps: [
    { title: "Créer ou sélectionner un catalogue", body: "Ouvrez la page Catalogues, saisissez un nom puis cliquez sur « Créer le catalogue ». Pour travailler dans un catalogue existant, ouvrez-le depuis la liste.", link: { to: "/catalogs", label: "Ouvrir les catalogues" } },
    { title: "Ajouter un produit", body: "Dans Mes produits, utilisez le bouton d'ajout. Renseignez au minimum le nom ; la marque, la description, le prix, l'image et le lien d'achat sont facultatifs mais rendent les recommandations plus claires pour vos clients.", link: { to: "/catalog/new", label: "Ajouter un produit" } },
    { title: "Importer des produits par CSV", body: "Exportez votre liste depuis votre logiciel au format CSV (5 Mo maximum), déposez le fichier, puis associez chaque colonne à un champ POAPO. La colonne « Nom » est obligatoire. Les produits sont créés à la fin de l'import et un résumé indique ceux qui ont été ignorés.", link: { to: "/catalog/import", label: "Importer un fichier CSV" } },
    { title: "Vérifier les critères des produits", body: "Ouvrez la fiche d'un produit : la section « Axes de recommandation » indique sa position entre 0 et 1 sur chaque préférence de votre expérience. Un produit sans valeurs ne peut pas être recommandé correctement.", link: { to: "/catalog", label: "Voir mes produits" } },
    { title: "Faciliter la saisie des critères", body: "La page « Enrichissement IA des produits » propose une estimation des valeurs d'axes à partir des fiches. Relisez les résultats : vous pouvez toujours les corriger dans la fiche produit.", link: { to: "/enrichment", label: "Ouvrir l'enrichissement" } },
  ],
  tips: [
    "Plus vos descriptions sont précises, plus les critères sont faciles à renseigner.",
    "Vous pouvez désactiver un produit pour qu'il ne soit plus recommandé, sans le supprimer.",
    "Les critères d'un produit dépendent des préférences définies dans l'expérience : voir le guide suivant.",
  ],
};

export const GUIDE_EXPERIENCE: HelpArticle = {
  slug: "creer-une-experience",
  number: 2,
  title: "Créer une expérience",
  summary: "Créez un quiz de recommandation adapté à votre boutique.",
  minutes: 10,
  category: "Expérience",
  icon: "sparkles",
  intro: "Une expérience est un quiz de recommandation : vos clients répondent à quelques questions et reçoivent les produits qui leur correspondent le mieux.",
  sections: [
    {
      title: "Comprendre les préférences (axes)",
      paragraphs: [
        "Une préférence, aussi appelée axe, est une échelle entre deux extrêmes. Chaque produit y a une position, et les réponses du visiteur le placent aussi sur ces échelles : POAPO recommande les produits les plus proches.",
      ],
      items: [
        "Café : Douce ↔ Vive (acidité) ; Léger ↔ Corsé (intensité).",
        "Cosmétique : Peau sèche ↔ Peau grasse ; Naturel ↔ Technique.",
        "Mode : Classique ↔ Tendance ; Économique ↔ Haut de gamme.",
        "Vin : Léger ↔ Puissant ; Sec ↔ Doux.",
      ],
    },
  ],
  steps: [
    { title: "Lancer l'assistant de création", body: "Dans Mes expériences, cliquez sur « Créer une expérience ». L'assistant vous guide en cinq étapes : produits, préférences, questions, personnalisation et test, vérification et publication.", link: { to: "/experiences/new", label: "Créer une expérience" } },
    { title: "Choisir un catalogue", body: "À la première étape, sélectionnez le catalogue qui contient les produits à recommander. Vous pouvez utiliser tous les produits actifs ou en sélectionner certains.", link: { to: "/quizzes", label: "Mes expériences" } },
    { title: "Configurer les préférences", body: "À l'étape « Mes préférences », ajoutez les axes qui différencient vos produits. Des exemples adaptés à votre activité sont proposés : ajoutez-les puis adaptez les libellés, ou saisissez les vôtres (12 maximum). Chaque axe a un libellé bas (0) et un libellé haut (1)." },
    { title: "Enregistrer votre progression", body: "L'assistant enregistre un brouillon à chaque étape. Vous pouvez quitter et reprendre plus tard : rien n'est visible du public tant que vous n'avez pas publié." },
  ],
  tips: [
    "Commencez avec 2 à 4 axes : un quiz court est plus souvent terminé.",
    "Choisissez des axes qui distinguent réellement vos produits entre eux.",
    "Vous pouvez créer autant d'expériences que nécessaire.",
  ],
};

export const GUIDE_QUESTIONS: HelpArticle = {
  slug: "personnaliser-les-questions",
  number: 3,
  title: "Personnaliser les questions",
  summary: "Choisissez et configurez les questions de votre quiz.",
  minutes: 10,
  category: "Expérience",
  icon: "quiz",
  intro: "Les questions sont ce que vos clients voient. Chaque réponse oriente la recommandation vers certains produits.",
  sections: [{
    title: "Comment les réponses influencent les recommandations",
    paragraphs: [
      "Chaque réponse peut décaler une ou plusieurs préférences de l'expérience, via un curseur allant de -1 à +1. Par exemple, la réponse « Je préfère un café doux » peut tirer l'axe acidité vers le libellé bas (« Douce ») : les produits proches de cette position remontent alors dans les résultats.",
      "Une question peut être à choix unique ou à choix multiple. Un indicateur de couverture des axes signale les préférences qu'aucune réponse n'influence encore.",
    ],
  }],
  steps: [
    { title: "Ajouter une question", body: "Dans l'éditeur, ouvrez la section Questions puis cliquez sur « Nouvelle question ». Saisissez l'intitulé, un texte d'aide facultatif, et choisissez choix unique ou multiple.", link: { to: "/quizzes", label: "Ouvrir une expérience" } },
    { title: "Configurer les réponses", body: "Ajoutez le texte de chaque réponse, puis réglez le curseur de chaque préférence (de -1 vers le libellé bas à +1 vers le libellé haut ; 0 = sans effet). Une réponse peut être désactivée avec l'option « Active ». Vous pouvez réordonner les questions et les réponses avec les boutons Monter / Descendre." },
    { title: "Prévisualiser le quiz", body: "La section Aperçu affiche le quiz tel que le verra votre client. Testez plusieurs parcours pour vérifier que les produits recommandés vous semblent cohérents." },
    { title: "Enregistrer le brouillon", body: "Cliquez sur « Enregistrer le brouillon ». Vos changements restent privés jusqu'à la publication." },
  ],
  tips: [
    "Des questions simples et concrètes (« Quel moment de la journée ? ») fonctionnent mieux que des questions techniques.",
    "Terminez ou annulez les formulaires ouverts avant d'enregistrer le brouillon.",
    "Si aucune préférence n'est définie, les réponses n'ont aucun effet : créez d'abord vos préférences dans la configuration de l'expérience.",
  ],
};
