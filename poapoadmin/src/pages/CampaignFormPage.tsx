import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Campaign, CampaignInput, CampaignOccasion, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";
import { CampaignImage } from "../components/CampaignVisuals";
import {
  CAMPAIGN_TEMPLATES,
  fromDateInput,
  OCCASION_LABELS,
  OCCASIONS,
  STATUS_LABELS,
  STATUSES,
  toDateInput,
} from "../lib/campaigns";

const MAX_OBJECTIVES = 10;

const STATUS_HINTS: Record<CampaignStatus, string> = {
  DRAFT: "En préparation, non diffusée.",
  SCHEDULED: "Affichée « En ligne » à partir de la date de début.",
  ACTIVE: "En ligne dès maintenant (ou dès la date de début si elle est future).",
  PAUSED: "Diffusion suspendue, réactivable à tout moment.",
  COMPLETED: "Clôturée manuellement.",
};

interface FormState {
  quizId: string;
  name: string;
  occasion: CampaignOccasion;
  occasionLabel: string;
  description: string;
  objectives: string[];
  imageUrl: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
}

function initialForm(occasion: CampaignOccasion | null, quizId: string): FormState {
  const template = occasion ? CAMPAIGN_TEMPLATES.find((item) => item.occasion === occasion) : undefined;
  const year = new Date().getFullYear();
  return {
    quizId,
    name: template && occasion !== "CUSTOM" ? `${template.title} ${year}` : "",
    occasion: occasion ?? "PROMOTION",
    occasionLabel: "",
    description: template && occasion !== "CUSTOM" ? template.subtitle : "",
    objectives: [""],
    imageUrl: "",
    status: "DRAFT",
    startsAt: "",
    endsAt: "",
  };
}

function fromCampaign(campaign: Campaign): FormState {
  return {
    quizId: campaign.quizId,
    name: campaign.name,
    occasion: campaign.occasion,
    occasionLabel: campaign.occasionLabel ?? "",
    description: campaign.description ?? "",
    objectives: campaign.objectives.length > 0 ? campaign.objectives : [""],
    imageUrl: campaign.imageUrl ?? "",
    status: campaign.status,
    startsAt: toDateInput(campaign.startsAt),
    endsAt: toDateInput(campaign.endsAt),
  };
}

export default function CampaignFormPage() {
  const { campaignId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { quizzes, loading: quizzesLoading } = useQuiz();
  const requestedOccasion = params.get("occasion") as CampaignOccasion | null;
  const templateOccasion = requestedOccasion && OCCASIONS.includes(requestedOccasion) ? requestedOccasion : null;
  const [form, setForm] = useState<FormState>(() => initialForm(templateOccasion, ""));
  const [loading, setLoading] = useState(!!campaignId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`)
      .then((campaign) => { if (!cancelled) setForm(fromCampaign(campaign)); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaignId]);

  // Pré-sélectionne le quiz par défaut (ou le premier) pour une nouvelle campagne.
  useEffect(() => {
    if (campaignId || form.quizId || quizzes.length === 0) return;
    const preferred = quizzes.find((quiz) => quiz.isDefault && quiz.active) ?? quizzes.find((quiz) => quiz.active) ?? quizzes[0];
    setForm((current) => ({ ...current, quizId: preferred.id }));
  }, [campaignId, form.quizId, quizzes]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const selectedQuiz = quizzes.find((quiz) => quiz.id === form.quizId);
  const quizInactive = !!selectedQuiz && !selectedQuiz.active;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) {
      setError("La date de fin doit être postérieure à la date de début.");
      return;
    }
    setSaving(true);
    const payload: CampaignInput = {
      quizId: form.quizId,
      name: form.name.trim(),
      occasion: form.occasion,
      occasionLabel: form.occasionLabel.trim() || null,
      description: form.description.trim() || null,
      objectives: form.objectives.map((item) => item.trim()).filter(Boolean),
      imageUrl: form.imageUrl.trim() || null,
      status: form.status,
      startsAt: fromDateInput(form.startsAt),
      endsAt: fromDateInput(form.endsAt, true),
    };
    try {
      const saved = await apiFetch<Campaign>(campaignId ? `/api/campaigns/${encodeURIComponent(campaignId)}` : "/api/campaigns", {
        method: campaignId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      navigate(`/campaigns/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-block">Chargement...</div>;

  return (
    <div className="page page-form">
      <div className="page-header">
        <div>
          <h1 className="page-title">{campaignId ? "Modifier la campagne" : "Nouvelle campagne"}</h1>
          <p className="page-subtitle">Une campagne associe un de vos quiz existants à une occasion marketing.</p>
        </div>
        <Link className="btn-ghost" to={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}>Annuler</Link>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      <form className="product-form" onSubmit={save}>
        <section className="form-section">
          <h2 className="section-title">Occasion</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-name">Nom de la campagne</label>
              <input id="campaign-name" className="field-input" required maxLength={120} placeholder="ex. Noël 2026"
                value={form.name} onChange={(e) => update("name", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-occasion">Occasion</label>
              <select id="campaign-occasion" className="field-select" value={form.occasion}
                onChange={(e) => update("occasion", e.target.value as CampaignOccasion)}>
                {OCCASIONS.map((value) => <option key={value} value={value}>{OCCASION_LABELS[value]}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-occasion-label">
                Libellé de l'occasion{form.occasion === "CUSTOM" ? "" : " (facultatif)"}
              </label>
              <input id="campaign-occasion-label" className="field-input" maxLength={80} required={form.occasion === "CUSTOM"}
                placeholder="ex. Anniversaire de la boutique" value={form.occasionLabel} onChange={(e) => update("occasionLabel", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-image">URL de l'image (facultatif)</label>
              <input id="campaign-image" className="field-input" type="url" maxLength={2048} placeholder="https://…"
                value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} />
            </div>
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="campaign-description">Description</label>
              <textarea id="campaign-description" className="field-textarea" rows={3} maxLength={1000}
                value={form.description} onChange={(e) => update("description", e.target.value)} />
            </div>
          </div>
          <div className="campaign-form-preview">
            <CampaignImage campaign={{ imageUrl: form.imageUrl.trim() || null, occasion: form.occasion }} />
          </div>
        </section>

        <section className="form-section">
          <h2 className="section-title">Quiz associé</h2>
          <div className="field-group">
            <label className="field-label" htmlFor="campaign-quiz">Quiz</label>
            <select id="campaign-quiz" className="field-select" required value={form.quizId} disabled={quizzesLoading}
              onChange={(e) => update("quizId", e.target.value)}>
              {!form.quizId && <option value="">Sélectionnez un quiz</option>}
              {quizzes.map((quiz) => (
                <option key={quiz.id} value={quiz.id}>{quiz.name}{quiz.isDefault ? " (par défaut)" : ""}{quiz.active ? "" : " — désactivé"}</option>
              ))}
            </select>
            <p className="field-hint">
              Le quiz, ses questions et ses recommandations restent inchangés.{" "}
              <Link className="table-link" to="/quizzes">Gérer mes quiz</Link>
            </p>
            {quizInactive && <p className="field-hint campaign-warning">Ce quiz est désactivé : la campagne ne pourra être programmée ou mise en ligne qu'après son activation.</p>}
          </div>
        </section>

        <section className="form-section">
          <h2 className="section-title">Objectifs</h2>
          <p className="section-hint">Ce que vous souhaitez obtenir avec cette campagne ({MAX_OBJECTIVES} maximum).</p>
          <div className="campaign-objectives">
            {form.objectives.map((objective, index) => (
              <div key={index} className="campaign-objective-row">
                <input className="field-input" maxLength={200} aria-label={`Objectif ${index + 1}`}
                  placeholder="ex. Augmenter le panier moyen" value={objective}
                  onChange={(e) => update("objectives", form.objectives.map((item, i) => (i === index ? e.target.value : item)))} />
                <button type="button" className="btn-danger" aria-label={`Retirer l'objectif ${index + 1}`}
                  onClick={() => update("objectives", form.objectives.length > 1 ? form.objectives.filter((_, i) => i !== index) : [""])}>
                  Retirer
                </button>
              </div>
            ))}
            {form.objectives.length < MAX_OBJECTIVES && (
              <button type="button" className="btn-link" onClick={() => update("objectives", [...form.objectives, ""])}>+ Ajouter un objectif</button>
            )}
          </div>
        </section>

        <section className="form-section">
          <h2 className="section-title">Diffusion</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-start">Date de début</label>
              <input id="campaign-start" className="field-input" type="date" required={form.status === "SCHEDULED"}
                value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="campaign-end">Date de fin</label>
              <input id="campaign-end" className="field-input" type="date" min={form.startsAt || undefined}
                value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} />
            </div>
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="campaign-status">Statut</label>
              <select id="campaign-status" className="field-select" value={form.status}
                onChange={(e) => update("status", e.target.value as CampaignStatus)}>
                {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
              </select>
              <p className="field-hint">{STATUS_HINTS[form.status]} Le statut affiché tient compte des dates.</p>
            </div>
          </div>
        </section>

        <div className="form-actions">
          <Link className="btn-ghost" to={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}>Annuler</Link>
          <button type="submit" className="btn-primary" disabled={saving || !form.quizId}>
            {saving ? "Enregistrement…" : campaignId ? "Enregistrer" : "Créer la campagne"}
          </button>
        </div>
      </form>
    </div>
  );
}
