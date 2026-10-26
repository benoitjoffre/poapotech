import { Link } from "react-router-dom";
import type { DashboardExperience } from "@poapo/types";
import Icon from "../Icon";
import { publicQuizLink, quizPath } from "../../lib/experienceLinks";
import "./experience-card.css";

export default function ExperienceCard({ experience, tenantId, days }: {
  experience: DashboardExperience;
  tenantId?: string;
  days: number;
}) {
  const needsEditing = experience.hasDraft || !experience.accessible || !!experience.correction;
  return <article className="experience-card">
    <div className="experience-card-cover" aria-hidden="true"><Icon name="quiz" size={30} /></div>
    <div className="experience-card-body">
      <div className="experience-badges">
        <span className={`experience-badge${experience.accessible ? " available" : ""}`}>
          {experience.accessible ? "Accessible au public" : "Désactivée pour le public"}
        </span>
        {experience.hasDraft && <span className="experience-badge draft">Brouillon enregistré</span>}
      </div>
      <h3>{experience.name}</h3>
      <p className="dashboard-muted">Catalogue : {experience.catalog.name}</p>
      {experience.correction && <p className="experience-correction">{experience.correction}</p>}
      <dl className="experience-metrics">
        <div><dt><Icon name="users" size={13} />Commencés</dt><dd>{experience.started.toLocaleString("fr-FR")}</dd></div>
        <div><dt><Icon name="check" size={13} />Terminés</dt><dd>{experience.completed.toLocaleString("fr-FR")}</dd></div>
      </dl>
      <p className="dashboard-muted">Ces {days} derniers jours</p>
      <div className="experience-actions">
        <Link className="btn-primary" to={quizPath(experience, needsEditing ? "/quizzes/" : "/analytics")}
          aria-label={`${needsEditing ? "Continuer l'édition" : "Voir les résultats"} : ${experience.name}`}>
          {needsEditing ? "Continuer l'édition" : "Voir les résultats"}
        </Link>
        <Link to={quizPath(experience, needsEditing ? "/analytics" : "/quizzes/")}
          aria-label={`${needsEditing ? "Voir les résultats" : "Continuer l'édition"} : ${experience.name}`}>
          {needsEditing ? "Voir les résultats" : "Continuer l'édition"}
        </Link>
        {experience.accessible && tenantId && <a href={publicQuizLink(tenantId, experience.id)} target="_blank" rel="noreferrer"
          aria-label={`Ouvrir l'expérience : ${experience.name} (nouvel onglet)`}>Ouvrir l'expérience ↗</a>}
      </div>
    </div>
  </article>;
}
