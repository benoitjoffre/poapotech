import { Link } from "react-router-dom";
import type { Campaign } from "@poapo/types";
import { formatPeriod } from "../../lib/campaigns";
import { CAMPAIGN_STATE_LABELS, campaignCountLabel } from "../../lib/experiences";

/** Les campagnes référencent ce quiz ; elles n'en possèdent aucune copie. */
export default function ExperienceCampaignsPanel({ campaigns, quizName }: { campaigns: Campaign[]; quizName: string }) {
  return <aside className="xe-campaigns" aria-labelledby="xe-campaigns-title">
    <h2 id="xe-campaigns-title">Campagnes liées · {campaigns.length}</h2>
    {campaigns.length === 0 ? <>
      <p className="xe-muted">Aucune campagne n'utilise cette expérience. Une campagne est facultative : le quiz reste diffusable par son lien public.</p>
      <Link className="btn-ghost btn-sm" to="/campaigns/new">Créer une campagne</Link>
    </> : <>
      <p className="xe-muted">{campaignCountLabel(campaigns.length)} {campaigns.length > 1 ? "utilisent" : "utilise"} le même quiz « {quizName} » et son brouillon.
        Une publication s'applique à toutes. Aucune copie du quiz n'existe par campagne.</p>
      <ul>{campaigns.map((campaign) => <li key={campaign.id}>
        <Link to={`/campaigns/${encodeURIComponent(campaign.id)}`}>{campaign.name}</Link>
        <span className="xe-muted">{formatPeriod(campaign)}</span>
        <span className={`xp-badge campaign-${campaign.effectiveStatus.toLowerCase()}`}>{CAMPAIGN_STATE_LABELS[campaign.effectiveStatus]}</span>
      </li>)}</ul>
    </>}
  </aside>;
}
