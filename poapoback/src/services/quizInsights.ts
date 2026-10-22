export interface MetricsSnapshot {
  started: number;
  completed: number;
  abandoned: number;
  completionRate: number;
  ctaClicks: number;
  ctaRate: number;
  feedbackPositive: number;
  feedbackNegative: number;
  topProducts: { name: string; count: number }[];
  topDropOffSteps: { step: string; dropOffRate: number; views: number }[];
}

export function localInsightsFromSnapshot(snapshot: MetricsSnapshot) {
  const insights: {
    title: string;
    insight: string;
    priority: "high" | "medium" | "low";
    actions: string[];
  }[] = [];

  if (snapshot.completionRate < 35) {
    insights.push({
      title: "Complétion faible",
      insight: `Le taux de complétion est de ${snapshot.completionRate}%, ce qui indique un fort abandon en cours de quiz.`,
      priority: "high",
      actions: [
        "Réduire le nombre de questions ou regrouper des étapes",
        "Raccourcir les intitulés de questions",
        "Ajouter une estimation de temps plus visible",
      ],
    });
  }

  if (snapshot.ctaRate < 20 && snapshot.completed > 10) {
    insights.push({
      title: "Conversion CTA sous-exploitée",
      insight: `Le CTR post-résultat est de ${snapshot.ctaRate}% malgré ${snapshot.completed} quiz complétés.`,
      priority: "high",
      actions: [
        "Tester un CTA plus orienté bénéfice",
        "Mettre un visuel produit plus grand dans le résultat",
        "Ajouter une preuve sociale sous le CTA",
      ],
    });
  }

  if (snapshot.feedbackNegative > snapshot.feedbackPositive) {
    insights.push({
      title: "Satisfaction en baisse",
      insight: `Les feedbacks négatifs (${snapshot.feedbackNegative}) dépassent les positifs (${snapshot.feedbackPositive}).`,
      priority: "medium",
      actions: [
        "Analyser les produits les plus souvent recommandés",
        "Ajuster les impacts de scoring des réponses",
        "Tester une variante de quiz plus guidée",
      ],
    });
  }

  if (snapshot.topDropOffSteps.length > 0) {
    const step = snapshot.topDropOffSteps[0];
    insights.push({
      title: "Étape à fort drop-off",
      insight: `L'étape ${step.step} a un drop-off de ${step.dropOffRate}% sur ${step.views} vues.`,
      priority: "medium",
      actions: [
        "Simplifier les options de cette étape",
        "Vérifier la lisibilité mobile",
        "Tester une formulation plus directe",
      ],
    });
  }

  if (insights.length === 0) {
    insights.push({
      title: "Traction saine",
      insight: "Les indicateurs clés sont équilibrés, aucune alerte critique détectée.",
      priority: "low",
      actions: [
        "Lancer un A/B test sur le texte CTA",
        "Suivre l'évolution hebdomadaire des steps",
        "Créer un segment nouveaux vs récurrents",
      ],
    });
  }

  return insights.slice(0, 3);
}
