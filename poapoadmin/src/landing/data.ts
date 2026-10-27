export const STEPS = [
  { title: "Catalogue", text: "Importez vos produits par CSV ou ajoutez-les un à un, avec leurs caractéristiques.", icon: "box" },
  { title: "Expérience", text: "Définissez vos axes de recommandation et construisez questions et réponses.", icon: "sliders" },
  { title: "Intégration", text: "Collez une balise script sur votre site : le widget s'adapte à votre marque.", icon: "code" },
  { title: "Recommandations", text: "Chaque visiteur reçoit une sélection personnalisée et vous suivez les résultats.", icon: "sparkle" },
] as const;

export const BENEFITS = [
  { title: "Comprenez vos clients", text: "grâce à des questions intelligentes", icon: "sparkle" },
  { title: "Recommandez les bons produits", text: "au bon moment", icon: "target" },
  { title: "Analysez les résultats", text: "pour affiner votre catalogue", icon: "chart" },
  { title: "Intégrez facilement", text: "sur votre site", icon: "puzzle" },
] as const;

export const FAQ = [
  { q: "Dois-je savoir coder pour utiliser POAPO ?", a: "Non. Vous construisez votre expérience depuis l'interface. L'intégration sur votre site se fait en collant une balise script." },
  { q: "Comment ajouter mon catalogue ?", a: "Par import CSV avec association guidée des colonnes, ou produit par produit. Vous pouvez avoir plusieurs catalogues." },
  { q: "POAPO convient-il à mon secteur ?", a: "Les axes de recommandation sont libres : café, parfum, voyage, mode ou tout autre univers où le choix est une question de goût." },
  { q: "L'IA est-elle obligatoire ?", a: "Non. La génération assistée de questions est optionnelle ; vous gardez la main sur chaque question et chaque réponse." },
  { q: "Puis-je tester avant de publier ?", a: "Oui. L'éditeur propose un aperçu interactif, et la publication ne se fait qu'une fois votre expérience prête." },
] as const;
