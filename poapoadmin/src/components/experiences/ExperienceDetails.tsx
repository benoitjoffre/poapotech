import { Link } from "react-router-dom";
import type { ExperienceListItem } from "@poapo/types";
import { publicQuizLink, quizPath } from "../../lib/experienceLinks";
import { periodSummary } from "../../lib/occasions";
import { questionCountLabel } from "../../lib/experiences";
import { EditAction } from "./ExperienceCard";
import ExperienceBadges from "./ExperienceBadges";
import { publicAvailability } from "../../lib/experiences";
import ExperienceStats from "./ExperienceStats";

export default function ExperienceDetails({ experience, tenantId, days, onClose, shopActive }: {
  experience: ExperienceListItem;
  tenantId?: string;
  days: number;
  shopActive?: boolean;
  onClose: () => void;
}) {
  const availability = publicAvailability({ shopActive: shopActive ?? true, quizActive: experience.accessible });
  return <aside className="xp-details" aria-labelledby="xp-details-title">
    <button type="button" className="btn-ghost xp-back" onClick={onClose}>← Retour à la liste</button>
    <ExperienceBadges experience={experience} shopActive={shopActive} />
    <h2 id="xp-details-title">{experience.name}</h2>
    <p className="xp-muted">Titre affiché aux visiteurs : {experience.quizTitle}{experience.industry ? ` · ${experience.industry}` : ""}</p>
    <dl className="xp-summary">
      <div><dt>Catalogue</dt><dd>{experience.catalog.name}</dd></div>
      <div><dt>Questions</dt><dd>{questionCountLabel(experience.questionCount)}</dd></div>
      <div><dt>Disponibilité publique</dt><dd>{availability.accessible ? "Accessible" : availability.reason}</dd></div>
      {periodSummary(experience) && <div><dt>Occasion et période</dt><dd>{periodSummary(experience)}</dd></div>}
      <div><dt>Brouillon</dt><dd>{experience.hasDraft ? "Enregistré" : "Aucun"}</dd></div>
    </dl>
    {experience.correction && <p className="xp-warning">{experience.correction}</p>}
    <ExperienceStats experience={experience} days={days} />
    <div className="xp-detail-actions">
      <EditAction experience={experience} />
      <Link className="btn-ghost" to={quizPath(experience, "/analytics")}>Voir les résultats</Link>
      {experience.accessible && tenantId
        ? <a className="btn-ghost" href={publicQuizLink(tenantId, experience.id)} target="_blank" rel="noreferrer">Prévisualiser (nouvel onglet)</a>
        : <span className="btn-ghost xp-disabled" aria-disabled="true">Aperçu indisponible : expérience désactivée</span>}
      <Link className="btn-ghost" to={quizPath(experience, "/quizzes/")}>Intégration et paramètres</Link>
    </div>
  </aside>;
}
