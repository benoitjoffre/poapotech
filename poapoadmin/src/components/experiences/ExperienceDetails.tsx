import { Link } from "react-router-dom";
import type { ExperienceListItem } from "@poapo/types";
import Icon from "../Icon";
import { campaignEditorPath, publicQuizLink, quizPath } from "../../lib/experienceLinks";
import { formatPeriod, occasionName } from "../../lib/campaigns";
import { CAMPAIGN_STATE_LABELS, campaignCountLabel, questionCountLabel } from "../../lib/experiences";
import { EditAction } from "./ExperienceCard";
import ExperienceBadges from "./ExperienceBadges";
import ExperienceStats from "./ExperienceStats";

export default function ExperienceDetails({ experience, tenantId, days, onClose }: {
  experience: ExperienceListItem;
  tenantId?: string;
  days: number;
  onClose: () => void;
}) {
  const campaigns = experience.campaigns;
  return <aside className="xp-details" aria-labelledby="xp-details-title">
    <button type="button" className="btn-ghost xp-back" onClick={onClose}>← Retour à la liste</button>
    <ExperienceBadges experience={experience} />
    <h2 id="xp-details-title">{experience.name}</h2>
    <p className="xp-muted">Titre public : {experience.quizTitle}{experience.industry ? ` · ${experience.industry}` : ""}</p>
    <dl className="xp-summary">
      <div><dt>Catalogue</dt><dd>{experience.catalog.name}</dd></div>
      <div><dt>Questions</dt><dd>{questionCountLabel(experience.questionCount)}</dd></div>
      <div><dt>Disponibilité publique</dt><dd>{experience.accessible ? "Accessible" : "Désactivée"}</dd></div>
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
    <section aria-labelledby="xp-campaigns-title" className="xp-campaigns">
      <h3 id="xp-campaigns-title"><Icon name="megaphone" size={16} />Campagnes utilisant cette expérience <span className="xp-count">{campaigns.length}</span></h3>
      {campaigns.length === 0
        ? <p className="xp-muted">{campaignCountLabel(0)} : l'expérience existe sans campagne.</p>
        : <ul>
          {campaigns.map((campaign) => <li key={campaign.id}>
            <div>
              <Link to={`/campaigns/${encodeURIComponent(campaign.id)}`}>{campaign.name}</Link>
              <span className="xp-muted">{occasionName(campaign)} · {formatPeriod(campaign)}</span>
            </div>
            <span className={`xp-campaign-state ${campaign.effectiveStatus.toLowerCase()}`}>{CAMPAIGN_STATE_LABELS[campaign.effectiveStatus]}</span>
            <Link className="xp-small-link" to={campaignEditorPath(campaign.id)}>Éditeur complet<span className="sr-only"> via la campagne {campaign.name}</span></Link>
          </li>)}
        </ul>}
      <p className="xp-note">
        {campaigns.length > 1 ? "Cette expérience est partagée : son contenu, son brouillon et ses statistiques sont communs à toutes les campagnes. " : ""}
        L'état d'une campagne ne contrôle pas l'accès public de l'expérience.
        {campaigns.length === 0 && " L'apparence, l'aperçu du brouillon et la publication passent encore par l'éditeur d'une campagne ; l'édition sans campagne arrivera dans une prochaine étape."}
      </p>
    </section>
  </aside>;
}
