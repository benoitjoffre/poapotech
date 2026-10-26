import type { Indicator } from "./quizMetrics";

// Instantané transmis aux insights : uniquement les indicateurs fiabilisés de /metrics (aucun ancien taux, aucun feedback).
export interface MetricsSnapshot {
  started: number;
  completed: number;
  recommendations: number;
  /** Clics vers une fiche produit : jamais des ventes. */
  productClicks: number;
  /** Abandons du widget corrigé uniquement : collecte partielle, jamais un taux. */
  recentAbandons: number;
  completionRate: Indicator;
  /** Ratio indicatif : les clics ne sont pas rattachés à une session. */
  clicksPer100Recommendations: Indicator;
  consistent: boolean;
  topProducts: { name: string; count: number }[];
  /** Étapes où l'écart vues − réponses est le plus fort (volumes bruts). */
  unansweredSteps: { step: string; views: number; answers: number }[];
}

type Insight = { title: string; insight: string; priority: "high" | "medium" | "low"; actions: string[] };

const formatRate = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function localInsightsFromSnapshot(snapshot: MetricsSnapshot) {
  const insights: Insight[] = [];
  const completion = snapshot.completionRate;

  if (completion.reliable && completion.value !== null && completion.value < 35) {
    insights.push({
      title: "Complétion faible",
      insight: `Le taux de complétion est de ${formatRate(completion.value)} % : beaucoup de parcours démarrés ne vont pas jusqu'au résultat.`,
      priority: "high",
      actions: [
        "Réduire le nombre de questions ou regrouper des étapes",
        "Raccourcir les intitulés de questions",
        "Ajouter une estimation de temps plus visible",
      ],
    });
  }

  if ((!completion.reliable && snapshot.started > 0) || !snapshot.consistent) {
    insights.push({
      title: "Données à vérifier",
      insight: completion.reason && snapshot.started > 0 && !completion.reliable
        ? completion.reason
        : `${snapshot.completed} quiz terminés pour ${snapshot.recommendations} recommandations générées : certains événements ont pu être perdus.`,
      priority: "medium",
      actions: [
        "Vérifier que le widget installé est à jour",
        "Comparer à nouveau sur une période plus récente",
      ],
    });
  }

  const clicks = snapshot.clicksPer100Recommendations;
  if (clicks.value !== null && clicks.value < 20 && snapshot.recommendations > 10) {
    insights.push({
      title: "Peu de clics produits",
      insight: `Environ ${formatRate(clicks.value)} clics produits pour 100 recommandations (indicatif : les clics ne sont pas rattachés à une session).`,
      priority: "medium",
      actions: [
        "Tester un texte de bouton plus orienté bénéfice",
        "Mettre un visuel produit plus grand dans le résultat",
      ],
    });
  }

  const step = snapshot.unansweredSteps[0];
  if (step) {
    insights.push({
      title: "Étape à surveiller",
      insight: `L'étape ${step.step} compte ${step.views} vues pour ${step.answers} réponses.`,
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
      title: "Pas d'alerte",
      insight: "Aucun signal préoccupant sur les indicateurs disponibles pour cette période.",
      priority: "low",
      actions: [
        "Suivre l'évolution des démarrages et des quiz terminés",
        "Vérifier régulièrement les étapes les plus vues",
      ],
    });
  }

  return insights.slice(0, 3);
}
