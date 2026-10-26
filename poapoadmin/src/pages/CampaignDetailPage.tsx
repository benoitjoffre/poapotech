import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Campaign, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import Icon from "../components/Icon";
import { CampaignImage, CampaignStatusToggle } from "../components/CampaignVisuals";
import ExperienceStats from "../components/experiences/ExperienceStats";
import { useAuth } from "../contexts/AuthContext";
import { useExperiencesOverview } from "../hooks/useExperiencesOverview";
import { DIFFUSION_NOTE, SHARED_NOTE, canDeleteCampaign, otherCampaigns, quizAccess, sharedLabel } from "../lib/campaignExperience";
import { campaignEditorPath, embedSnippet, experienceEditorPath, publicQuizLink, quizPath } from "../lib/experienceLinks";
import "./campaigns.css";
import { formatDate, formatPeriod, occasionName, startsIn, STATUS_LABELS } from "../lib/campaigns";

export default function CampaignDetailPage() {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { overview, error: overviewError } = useExperiencesOverview();
  const [copied, setCopied] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCampaign(await apiFetch<Campaign>(path));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: CampaignStatus) => run(async () => {
    setCampaign(await apiFetch<Campaign>(path, { method: "PUT", body: JSON.stringify({ status }) }));
  });

  const duplicate = () => run(async () => {
    const copy = await apiFetch<Campaign>(`${path}/duplicate`, { method: "POST" });
    navigate(`/campaigns/${copy.id}/edit`);
  });

  const remove = () => {
    if (!campaign || !window.confirm(`Supprimer le brouillon « ${campaign.name} » ? Cette action est définitive.`)) return;
    void run(async () => {
      await apiFetch(path, { method: "DELETE" });
      navigate("/campaigns", { replace: true });
    });
  };

  if (loading) return <div className="loading-block">Chargement...</div>;
  if (!campaign) {
    return (
      <div className="page">
        <div className="form-error">{error || "Campagne introuvable"}</div>
        <Link className="btn-ghost" to="/campaigns">Retour aux campagnes</Link>
      </div>
    );
  }

  const countdown = startsIn(campaign);
  const experience = overview?.experiences.find((item) => item.id === campaign.quiz.id);
  const shopActive = overview?.shopActive ?? null;
  const access = quizAccess(shopActive, campaign.quiz.active);
  const others = otherCampaigns(experience, campaign.id);
  const tenantId = user?.tenantId ?? "";
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(`${key}-error`);
    }
  };

  return (
    <div className="page campaign-detail cp">
      <div className="page-header">
        <div>
          <Link className="table-link" to="/campaigns">← Campagnes</Link>
          <h1 className="page-title">{campaign.name}</h1>
          <p className="page-subtitle">{occasionName(campaign)} · {formatPeriod(campaign)}</p>
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      <aside className="cp-note"><p>{DIFFUSION_NOTE}</p></aside>

      <div className="cp-detail-grid">
        <section className="cp-panel" aria-labelledby="cp-sec-campaign">
          <h2 id="cp-sec-campaign">Campagne</h2>
          <div className="cp-panel-visual"><CampaignImage campaign={campaign} /></div>
          <dl className="cp-facts">
            <div><dt>État de la campagne</dt><dd><span className={`xp-badge cp-status ${campaign.effectiveStatus.toLowerCase()}`}>{STATUS_LABELS[campaign.effectiveStatus]}</span>{countdown && <span className="cp-muted"> {countdown}</span>}</dd></div>
            {campaign.status !== campaign.effectiveStatus && <div><dt>Statut enregistré</dt><dd>{STATUS_LABELS[campaign.status]}</dd></div>}
            <div><dt>Début</dt><dd>{campaign.startsAt ? formatDate(campaign.startsAt) : "Non défini"}</dd></div>
            <div><dt>Fin</dt><dd>{campaign.endsAt ? formatDate(campaign.endsAt) : "Non définie"}</dd></div>
            <div><dt>Mise à jour</dt><dd>{formatDate(campaign.updatedAt)}</dd></div>
          </dl>
          {campaign.description && <p className="campaign-detail-text">{campaign.description}</p>}
          {campaign.objectives.length > 0 && (
            <>
              <h3>Objectifs</h3>
              <ul className="campaign-detail-objectives">{campaign.objectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul>
            </>
          )}
          <div className="cp-actions">
            <Link className="btn-primary" to={`/campaigns/${campaign.id}/edit`}><Icon name="edit" size={16} />Modifier la campagne</Link>
            <CampaignStatusToggle
              campaign={campaign}
              disabled={busy}
              onChange={(status) => {
                if (campaign.status === "DRAFT" && !window.confirm("Démarrer cette campagne ? Cela n'active pas l'accès public du quiz.")) return;
                void setStatus(status);
              }}
            />
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void duplicate()}><Icon name="copy" size={16} />Dupliquer</button>
            {canDeleteCampaign(campaign.status) && (
              <button type="button" className="btn-danger" disabled={busy} onClick={remove}><Icon name="trash" size={16} />Supprimer</button>
            )}
          </div>
        </section>

        <section className="cp-panel" aria-labelledby="cp-sec-exp">
          <h2 id="cp-sec-exp">Expérience associée</h2>
          <p className="cp-muted">{SHARED_NOTE}</p>
          <dl className="cp-facts">
            <div><dt>Expérience</dt><dd><strong>{campaign.quiz.name}</strong></dd></div>
            <div><dt>Catalogue</dt><dd>{campaign.quiz.catalog.name}</dd></div>
            <div><dt>Contenu</dt><dd>{campaign.quiz.questionCount} question{campaign.quiz.questionCount > 1 ? "s" : ""} · {campaign.quiz.productCount} produit{campaign.quiz.productCount > 1 ? "s" : ""}</dd></div>
            <div><dt>Accessibilité publique</dt><dd>
              {access
                ? <span className={`xp-badge ${access.accessible ? "public" : "inactive"}`}>{access.label}{access.reason ? ` · ${access.reason}` : ""}</span>
                : <span className="xp-badge neutral">Quiz actif</span>}
            </dd></div>
            <div><dt>Brouillon du quiz</dt><dd>
              {experience
                ? <span className={`xp-badge ${experience.hasDraft ? "draft" : "neutral"}`}>{experience.hasDraft ? "Brouillon enregistré" : "Aucun brouillon"}</span>
                : <span className="cp-muted">{overviewError ? "Indisponible" : "Chargement…"}</span>}
            </dd></div>
            <div><dt>Partage</dt><dd>{experience ? sharedLabel(others.length) : "—"}</dd></div>
          </dl>
          {others.length > 0 && (
            <ul className="cp-others" aria-label="Autres campagnes utilisant cette expérience">
              {others.map((other) => <li key={other.id}><Link className="table-link" to={`/campaigns/${other.id}`}>{other.name}</Link></li>)}
            </ul>
          )}
          <div className="cp-actions">
            <Link className="btn-primary" to={experienceEditorPath(campaign.quiz.id)}>Modifier l'expérience</Link>
            <Link className="btn-ghost" to={`${quizPath(campaign.quiz as never, "/analytics")}&from=campaign`}>Voir les résultats</Link>
          </div>
          <div className="cp-share">
            <h3>Partage et intégration</h3>
            {access?.accessible && tenantId ? (
              <>
                <p className="cp-muted">Lien public de l'expérience (le même pour toutes les campagnes : aucun lien propre à la campagne n'existe sans suivi dédié).</p>
                <code className="cp-code" data-testid="public-link">{publicQuizLink(tenantId, campaign.quiz.id)}</code>
                <div className="cp-actions">
                  <button type="button" className="btn-ghost" onClick={() => void copy("link", publicQuizLink(tenantId, campaign.quiz.id))}>Copier le lien public</button>
                  <button type="button" className="btn-ghost" onClick={() => void copy("embed", embedSnippet(tenantId, campaign.quiz.id))}>Copier le code d'intégration</button>
                </div>
                <p role="status" className="cp-muted">{copied === "link" ? "Lien copié." : copied === "embed" ? "Code d'intégration copié." : copied.endsWith("-error") ? "Copie impossible : sélectionnez le texte manuellement." : ""}</p>
              </>
            ) : (
              <p className="cp-muted">
                {access && !access.accessible
                  ? `Le quiz n'est pas accessible au public (${access.reason ?? "inactif"}) : le lien public et le code d'intégration seront proposés une fois activé depuis l'éditeur de l'expérience.`
                  : "Chargement de l'état d'accessibilité…"}
              </p>
            )}
          </div>
          <div className="cp-advanced">
            <h3>Campaign Studio</h3>
            <div className="cp-actions">
              <Link className="btn-ghost" to={campaignEditorPath(campaign.id)}>Personnaliser le quiz</Link>
              <Link className="btn-ghost" to={`/campaigns/${campaign.id}/generate-quiz`}>✨ Générer un quiz avec l'IA</Link>
            </div>
            <p className="cp-muted">
              La génération part des axes de ce quiz et enregistre un nouveau quiz inactif
              {campaign.status === "DRAFT" ? ", que vous pouvez associer à cette campagne." : " indépendant, car la campagne n'est plus en brouillon."}
            </p>
          </div>
        </section>
      </div>

      <section className="cp-panel" aria-labelledby="cp-sec-stats">
        <h2 id="cp-sec-stats">Résultats de l'expérience associée</h2>
        <p className="cp-muted">Ces chiffres concernent le quiz, partagé par toutes les campagnes qui l'utilisent ; ils ne mesurent pas la performance de cette campagne seule. Aucune vente n'est suivie.</p>
        {experience && overview
          ? <ExperienceStats experience={experience} days={overview.period.days} />
          : <p className="cp-muted">{overviewError || "Chargement…"}</p>}
      </section>
    </div>
  );
}
