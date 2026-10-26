import { Link } from "react-router-dom";
import type { ExperienceListItem } from "@poapo/types";
import Icon from "../Icon";
import { publicQuizLink, questionsEditorPath, quizPath } from "../../lib/experienceLinks";
import { campaignCountLabel, questionCountLabel } from "../../lib/experiences";
import ExperienceBadges from "./ExperienceBadges";
import ExperienceStats from "./ExperienceStats";

const modified = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function EditAction({ experience, className = "btn-primary" }: { experience: ExperienceListItem; className?: string }) {
  return <Link className={className} to={questionsEditorPath(experience)}>
    {experience.hasDraft ? "Reprendre le brouillon" : "Éditer"}
    <span className="sr-only"> : {experience.name}</span>
  </Link>;
}

export default function ExperienceCard({ experience, selected, onSelect, tenantId, days }: {
  experience: ExperienceListItem;
  selected: boolean;
  onSelect: () => void;
  tenantId?: string;
  days: number;
}) {
  const link = (extra: string) => `${extra} : ${experience.name}`;
  return <article className={`xp-card${selected ? " selected" : ""}`}>
    <div className="xp-cover" aria-hidden="true"><Icon name="quiz" size={28} /></div>
    <div className="xp-card-main">
      <ExperienceBadges experience={experience} />
      <h3>
        <button type="button" className="xp-select" aria-pressed={selected} onClick={onSelect}>
          {experience.name}<span className="sr-only"> — afficher les détails</span>
        </button>
      </h3>
      <p className="xp-muted">Titre public : {experience.quizTitle}</p>
      <ul className="xp-tags">
        <li>{experience.catalog.name}</li>
        <li>{questionCountLabel(experience.questionCount)}</li>
        <li>{campaignCountLabel(experience.campaigns.length)}</li>
      </ul>
      {experience.correction && <p className="xp-warning">{experience.correction}</p>}
      <ExperienceStats experience={experience} days={days} />
      <p className="xp-muted">Dernière modification : {modified.format(new Date(experience.lastModifiedAt))}</p>
    </div>
    <div className="xp-card-actions">
      <EditAction experience={experience} />
      <Link className="btn-ghost" to={quizPath(experience, "/analytics")}>Voir les résultats<span className="sr-only"> {link("")}</span></Link>
      <div className="xp-links">
        {experience.accessible && tenantId
          ? <a href={publicQuizLink(tenantId, experience.id)} target="_blank" rel="noreferrer">Prévisualiser<span className="sr-only"> {link("")} (nouvel onglet)</span></a>
          : <span className="xp-muted" title="Une expérience désactivée n'est pas accessible au public">Aperçu indisponible</span>}
        <Link to={quizPath(experience, "/quizzes/")}>Intégration<span className="sr-only"> {link("")}</span></Link>
      </div>
    </div>
  </article>;
}
