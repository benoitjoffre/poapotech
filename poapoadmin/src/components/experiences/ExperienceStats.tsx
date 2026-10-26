import type { ExperienceListItem } from "@poapo/types";

/** Statistiques réelles sur la période ; aucun achat ni variation n'est affiché. */
export default function ExperienceStats({ experience, days }: { experience: ExperienceListItem; days: number }) {
  if (!experience.stats) {
    return <p className="xp-muted xp-nodata">Pas encore de données sur ces {days} derniers jours.</p>;
  }
  const { started, completed, productClicks } = experience.stats;
  return <>
    <dl className="xp-stats">
      <div><dt>Commencés</dt><dd>{started.toLocaleString("fr-FR")}</dd></div>
      <div><dt>Terminés</dt><dd>{completed.toLocaleString("fr-FR")}</dd></div>
      <div><dt>Clics produits</dt><dd>{productClicks.toLocaleString("fr-FR")}</dd></div>
    </dl>
    <p className="xp-muted">Ces {days} derniers jours</p>
  </>;
}
