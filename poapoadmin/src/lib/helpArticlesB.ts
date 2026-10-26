import type { HelpArticle } from "./helpTypes";

export const GUIDE_PUBLISH: HelpArticle = {
  slug: "tester-et-publier",
  number: 4,
  title: "Tester et publier",
  summary: "Vérifiez les recommandations et rendez votre quiz accessible.",
  minutes: 5,
  category: "Publication",
  icon: "eye",
  intro: "Avant de partager votre quiz, testez-le, enregistrez votre brouillon, puis publiez-le. Publication et accessibilité sont deux choses distinctes.",
  sections: [{
    title: "Publication et accessibilité : la différence",
    items: [
      "Publier remplace la version vue par le public par votre dernier brouillon enregistré.",
      "L'accès public (actif / inactif) décide si le quiz peut être ouvert par vos clients via son lien ou le widget.",
      "Publier ne rend pas à lui seul le quiz accessible s'il est inactif ; et le désactiver ne supprime pas la version publiée.",
      "Une campagne programmée ne change pas l'accessibilité du quiz.",
    ],
  }],
  steps: [
    { title: "Tester l'expérience", body: "Dans la section Aperçu, répondez au quiz comme un client. Essayez plusieurs combinaisons de réponses.", link: { to: "/quizzes", label: "Mes expériences" } },
    { title: "Interpréter les recommandations", body: "Les produits affichés sont ceux dont les critères sont les plus proches des préférences exprimées. Si un résultat vous surprend, vérifiez les critères du produit et l'effet des réponses." },
    { title: "Enregistrer un brouillon", body: "« Enregistrer le brouillon » conserve vos modifications sans changer ce que voit le public." },
    { title: "Publier", body: "Dans la section Publication, cliquez sur « Vérifier le quiz ». Corrigez les erreurs bloquantes éventuelles, confirmez, puis « Publier le brouillon ». Seule la révision enregistrée est publiée." },
    { title: "Activer ou désactiver l'accès public", body: "L'état actif / inactif est préparé dans le brouillon et appliqué à la publication. Le résumé en haut de l'éditeur indique si le quiz est accessible au public ; un quiz est inaccessible si l'expérience ou la boutique est désactivée." },
  ],
  tips: [
    "Aucun produit n'est modifié par la publication d'un quiz.",
    "Si plusieurs campagnes utilisent la même expérience, une confirmation supplémentaire vous est demandée.",
  ],
};

export const GUIDE_INTEGRATE: HelpArticle = {
  slug: "integrer-sur-votre-site",
  number: 5,
  title: "Intégrer sur votre site",
  summary: "Récupérez le lien public ou le code pour afficher le quiz.",
  minutes: 5,
  category: "Intégration",
  icon: "copy",
  intro: "Une fois publié et accessible, votre quiz peut être partagé par lien ou affiché sur votre site grâce à un petit code à copier.",
  steps: [
    { title: "Récupérer le lien public", body: "Dans l'éditeur de l'expérience, le lien public (version publiée) apparaît en haut de page lorsque le quiz est accessible. Vous pouvez aussi utiliser « Copier le lien public » depuis l'étape de publication de l'assistant ou depuis la fiche d'une campagne.", link: { to: "/quizzes", label: "Mes expériences" } },
    { title: "Copier le code d'intégration", body: "Le bouton « Copier le code d'intégration » est proposé à la fin de l'assistant et dans la fiche d'une campagne. Le code du quiz par défaut est aussi disponible dans les Paramètres.", link: { to: "/settings", label: "Ouvrir les paramètres" } },
    { title: "Ajouter le widget à votre site", body: "Collez le script dans la page où le quiz doit apparaître. Cela fonctionne sur tout site qui permet d'ajouter du code HTML ou un script personnalisé. POAPO ne propose pas d'application native pour une plateforme donnée." },
    { title: "Vérifier le fonctionnement", body: "Ouvrez la page de votre site, lancez le quiz et allez jusqu'aux recommandations. Vérifiez ensuite dans Résultats que le démarrage est bien comptabilisé.", link: { to: "/analytics", label: "Voir les résultats" } },
  ],
  tips: [
    "Si vous avez renseigné un domaine autorisé dans les Paramètres, le widget ne fonctionnera que sur ce domaine.",
    "Si le lien est indisponible, l'expérience ou la boutique est désactivée : voir le guide précédent.",
  ],
};

export const GUIDE_RESULTS: HelpArticle = {
  slug: "comprendre-vos-resultats",
  number: 6,
  title: "Comprendre vos résultats",
  summary: "Suivez l'usage de vos quiz et les produits qui intéressent.",
  minutes: 5,
  category: "Résultats",
  icon: "chart",
  intro: "La page Résultats montre comment vos visiteurs utilisent chaque expérience.",
  sections: [{
    title: "Ce que mesure chaque chiffre",
    items: [
      "Démarrages : nombre de fois où un visiteur a commencé le quiz.",
      "Quiz terminés : nombre de quiz menés jusqu'au bout.",
      "Recommandations générées : nombre de fois où des produits ont été proposés.",
      "Clics vers les produits : nombre de clics sur un produit recommandé.",
    ],
  }, {
    title: "À retenir",
    paragraphs: [
      "Un clic vers un produit n'est pas une vente : POAPO ne mesure pas les achats.",
      "Les statistiques ne sont pas attribuées individuellement aux campagnes : elles sont suivies par expérience.",
    ],
  }],
  steps: [
    { title: "Ouvrir les résultats", body: "Cliquez sur Résultats dans le menu pour voir l'ensemble de vos expériences.", link: { to: "/analytics", label: "Ouvrir les résultats" } },
    { title: "Choisir une période", body: "Sélectionnez 7, 30 ou 90 jours. Les tendances se comparent à la période précédente de même durée." },
    { title: "Lire les résultats par expérience", body: "Le tableau liste chaque expérience avec ses chiffres ; vous pouvez le trier. Ouvrez une expérience pour voir les produits les plus recommandés et les plus cliqués." },
  ],
  tips: [
    "Sans données sur la période, essayez une période plus longue ou partagez votre expérience.",
    "Comparez les démarrages et les quiz terminés pour repérer un quiz trop long.",
  ],
};
