import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Campaign, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import Icon from "../components/Icon";
import { CampaignImage, CampaignStatusToggle } from "../components/CampaignVisuals";
import { formatDate, formatPeriod, occasionName, startsIn, STATUS_LABELS } from "../lib/campaigns";

export default function CampaignDetailPage() {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
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
  const quizQuery = `?quizId=${encodeURIComponent(campaign.quiz.id)}`;

  return (
    <div className="page campaign-detail">
      <div className="page-header">
        <div>
          <Link className="table-link" to="/campaigns">← Campagnes</Link>
          <h1 className="page-title">{campaign.name}</h1>
          <p className="page-subtitle">{occasionName(campaign)} · {formatPeriod(campaign)}</p>
        </div>
        <div className="campaign-detail-actions">
          <CampaignStatusToggle
            campaign={campaign}
            disabled={busy}
            onChange={(status) => {
              if (campaign.status === "DRAFT" && !window.confirm("Mettre ce brouillon en ligne ?")) return;
              void setStatus(status);
            }}
          />
          <Link className="btn-primary" to={`/campaigns/${campaign.id}/edit`}><Icon name="edit" size={16} />Modifier</Link>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void duplicate()}><Icon name="copy" size={16} />Dupliquer</button>
          {campaign.status === "DRAFT" && (
            <button type="button" className="btn-danger" disabled={busy} onClick={remove}><Icon name="trash" size={16} />Supprimer</button>
          )}
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="campaign-detail-grid">
        <div className="campaign-detail-visual">
          <CampaignImage campaign={campaign} />
        </div>
        <dl className="campaign-detail-facts">
          <div><dt>Statut</dt><dd><span className={`campaign-badge status-${campaign.effectiveStatus.toLowerCase()}`}>{STATUS_LABELS[campaign.effectiveStatus]}</span>{countdown && <span className="campaign-countdown"> {countdown}</span>}</dd></div>
          {campaign.status !== campaign.effectiveStatus && <div><dt>Statut enregistré</dt><dd>{STATUS_LABELS[campaign.status]}</dd></div>}
          <div><dt>Début</dt><dd>{campaign.startsAt ? formatDate(campaign.startsAt) : "Non défini"}</dd></div>
          <div><dt>Fin</dt><dd>{campaign.endsAt ? formatDate(campaign.endsAt) : "Non définie"}</dd></div>
          <div>
            <dt>Quiz</dt>
            <dd>
              {campaign.quiz.name} · {campaign.quiz.questionCount} question{campaign.quiz.questionCount > 1 ? "s" : ""} · {campaign.quiz.productCount} produit{campaign.quiz.productCount > 1 ? "s" : ""}
              {!campaign.quiz.active && <span className="campaign-chip chip-warning">Quiz désactivé</span>}
            </dd>
          </div>
          <div><dt>Mise à jour</dt><dd>{formatDate(campaign.updatedAt)}</dd></div>
        </dl>
      </div>

      <section className="form-section">
        <h2 className="section-title">Description</h2>
        <p className={campaign.description ? "campaign-detail-text" : "text-muted"}>{campaign.description || "Aucune description."}</p>
      </section>

      <section className="form-section">
        <h2 className="section-title">Objectifs</h2>
        {campaign.objectives.length > 0 ? (
          <ul className="campaign-detail-objectives">
            {campaign.objectives.map((objective, index) => <li key={index}>{objective}</li>)}
          </ul>
        ) : (
          <p className="text-muted">Aucun objectif défini.</p>
        )}
      </section>

      <section className="form-section">
        <h2 className="section-title">Quiz associé</h2>
        <p className="section-hint">La campagne s'appuie sur ce quiz sans le modifier : questions, recommandations et intégration restent celles du quiz.</p>
        <div className="campaign-detail-links">
          <Link className="btn-ghost" to={`/quizzes/${encodeURIComponent(campaign.quiz.id)}`}>Configurer / intégrer le quiz</Link>
          <Link className="btn-ghost" to={`/quiz-builder${quizQuery}`}>Questions</Link>
        </div>
      </section>
    </div>
  );
}
