import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Campaign, CampaignInput, CampaignOccasion, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";
import { CampaignImage } from "../components/CampaignVisuals";
import { useExperiencesOverview } from "../hooks/useExperiencesOverview";
import { DIFFUSION_NOTE, SHARED_NOTE, STATUS_HINTS, datesProblem, otherCampaigns, quizAccess, sharedLabel, statusBlockedReason } from "../lib/campaignExperience";
import { experienceEditorPath } from "../lib/experienceLinks";
import "./campaigns.css";
import {
  CAMPAIGN_TEMPLATES,
  fromDateInput,
  formatDate,
  OCCASION_LABELS,
  OCCASIONS,
  STATUS_LABELS,
  STATUSES,
  toDateInput,
} from "../lib/campaigns";

const MAX_OBJECTIVES = 10;

const STEPS = ["Informations", "Expérience", "Dates et statut", "Récapitulatif"] as const;

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
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState("");
  const { overview } = useExperiencesOverview();

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

  const stepProblem = (index: number): string | null => {
    if (index === 0) {
      if (!form.name.trim()) return "Donnez un nom à la campagne.";
      if (form.occasion === "CUSTOM" && !form.occasionLabel.trim()) return "Précisez le libellé de l'occasion personnalisée.";
    }
    if (index === 1 && !form.quizId) return "Choisissez l'expérience associée.";
    if (index === 2) return datesProblem(form.startsAt, form.endsAt) ?? statusBlockedReason(form.status, selectedQuiz?.active, form.startsAt);
    return null;
  };

  const goTo = (target: number) => {
    if (target > step) {
      for (let i = step; i < target; i += 1) {
        const problem = stepProblem(i);
        if (problem) { setStepError(problem); setStep(i); return; }
      }
    }
    setStepError("");
    setStep(target);
  };

  const persist = async (status: CampaignStatus, quit: boolean) => {
    setError("");
    const problem = datesProblem(form.startsAt, form.endsAt) ?? stepProblem(0) ?? stepProblem(1);
    if (problem) { setStepError(problem); return; }
    setStepError("");
    setSaving(true);
    const payload: CampaignInput = {
      quizId: form.quizId,
      name: form.name.trim(),
      occasion: form.occasion,
      occasionLabel: form.occasionLabel.trim() || null,
      description: form.description.trim() || null,
      objectives: form.objectives.map((item) => item.trim()).filter(Boolean),
      imageUrl: form.imageUrl.trim() || null,
      status,
      startsAt: fromDateInput(form.startsAt),
      endsAt: fromDateInput(form.endsAt, true),
    };
    try {
      const saved = await apiFetch<Campaign>(campaignId ? `/api/campaigns/${encodeURIComponent(campaignId)}` : "/api/campaigns", {
        method: campaignId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      navigate(quit ? "/campaigns" : `/campaigns/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < STEPS.length - 1) { goTo(step + 1); return; }
    const problem = stepProblem(2);
    if (problem) { setStepError(problem); setStep(2); return; }
    void persist(form.status, false);
  };

  if (loading) return <div className="loading-block">Chargement...</div>;

  const quizInfo = (id: string) => overview?.experiences.find((item) => item.id === id);
  const selectedInfo = quizInfo(form.quizId);
  const selectedAccess = selectedQuiz ? quizAccess(overview?.shopActive ?? null, selectedQuiz.active) : null;
  const last = step === STEPS.length - 1;

  return (
    <div className="page page-form cp">
      <div className="page-header">
        <div>
          <h1 className="page-title">{campaignId ? "Modifier la campagne" : "Nouvelle campagne"}</h1>
          <p className="page-subtitle">Une campagne relie une occasion commerciale et des dates à une expérience existante, sans la copier.</p>
        </div>
        <Link className="btn-ghost" to={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}>Annuler</Link>
      </div>

      <ol className="cp-steps" aria-label="Étapes">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button type="button" className={`cp-step${index === step ? " current" : ""}${index < step ? " done" : ""}`}
              aria-current={index === step ? "step" : undefined} onClick={() => goTo(index)}>
              <span className="cp-step-num">{index + 1}</span><span className="cp-step-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      {(error || stepError) && <div className="form-error" role="alert">{error || stepError}</div>}

      <form className="product-form cp-form" onSubmit={submit} noValidate>
        {step === 0 && (
          <section className="form-section" aria-labelledby="cp-step-title">
            <h2 id="cp-step-title" className="section-title">Informations</h2>
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label" htmlFor="campaign-name">Nom de la campagne</label>
                <input id="campaign-name" className="field-input" maxLength={120} placeholder="ex. Noël 2026"
                  value={form.name} onChange={(e) => update("name", e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="campaign-occasion">Occasion commerciale</label>
                <select id="campaign-occasion" className="field-select" value={form.occasion}
                  onChange={(e) => update("occasion", e.target.value as CampaignOccasion)}>
                  {OCCASIONS.map((value) => <option key={value} value={value}>{OCCASION_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="campaign-occasion-label">
                  Libellé de l'occasion{form.occasion === "CUSTOM" ? "" : " (facultatif)"}
                </label>
                <input id="campaign-occasion-label" className="field-input" maxLength={80}
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
            <h3 className="cp-sub">Objectifs</h3>
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
        )}

        {step === 1 && (
          <section className="form-section" aria-labelledby="cp-step-title">
            <h2 id="cp-step-title" className="section-title">Expérience associée</h2>
            <p className="section-hint">{SHARED_NOTE} Créer une campagne ne demande aucune modification de l'expérience.</p>
            {quizzesLoading ? <p className="cp-muted" role="status">Chargement des expériences…</p> : quizzes.length === 0 ? (
              <div className="cp-empty">
                <h3>Aucune expérience disponible</h3>
                <p>Une campagne s'appuie sur une expérience existante. Créez-en une d'abord.</p>
                <Link className="btn-primary" to="/quizzes/new">Créer une expérience</Link>
              </div>
            ) : (
              <div role="radiogroup" aria-label="Expérience associée" className="cp-choices">
                {quizzes.map((quiz) => {
                  const info = quizInfo(quiz.id);
                  const access = quizAccess(overview?.shopActive ?? null, quiz.active);
                  const checked = form.quizId === quiz.id;
                  return (
                    <label key={quiz.id} className={`cp-choice${checked ? " selected" : ""}`}>
                      <input type="radio" name="campaign-quiz" value={quiz.id} checked={checked} onChange={() => update("quizId", quiz.id)} />
                      <span className="cp-choice-body">
                        <strong>{quiz.name}</strong>
                        <span className="cp-muted">Catalogue : {info?.catalog.name ?? "—"}</span>
                        <span className="xp-badges">
                          {access
                            ? <span className={`xp-badge ${access.accessible ? "public" : "inactive"}`}>Quiz : {access.label}</span>
                            : <span className="xp-badge neutral">Quiz : actif</span>}
                        </span>
                        <span className="cp-muted">{info ? `Utilisée par ${info.campaigns.length} campagne${info.campaigns.length > 1 ? "s" : ""}` : ""}{info && info.campaigns.length > 1 ? " — partagée, pas copiée" : ""}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedQuiz && (
              <p className="section-hint">
                <Link className="table-link" to={experienceEditorPath(selectedQuiz.id)}>Modifier cette expérience dans l'éditeur</Link>
                {" "}(vos saisies ici ne sont pas enregistrées tant que vous n'avez pas terminé ; enregistrez d'abord si besoin).
              </p>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="form-section" aria-labelledby="cp-step-title">
            <h2 id="cp-step-title" className="section-title">Dates et statut</h2>
            <p className="cp-note">{DIFFUSION_NOTE}</p>
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label" htmlFor="campaign-start">Date de début</label>
                <input id="campaign-start" className="field-input" type="date" value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="campaign-end">Date de fin</label>
                <input id="campaign-end" className="field-input" type="date" min={form.startsAt || undefined}
                  value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} />
              </div>
              <div className="field-group field-span2">
                <label className="field-label" htmlFor="campaign-status">Statut de la campagne</label>
                <select id="campaign-status" className="field-select" value={form.status}
                  onChange={(e) => update("status", e.target.value as CampaignStatus)}>
                  {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
                </select>
                <p className="field-hint">{STATUS_HINTS[form.status]} Le statut affiché tient compte des dates.</p>
              </div>
            </div>
            {statusBlockedReason(form.status, selectedQuiz?.active, form.startsAt) && (
              <p className="field-hint campaign-warning">{statusBlockedReason(form.status, selectedQuiz?.active, form.startsAt)}</p>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="form-section" aria-labelledby="cp-step-title">
            <h2 id="cp-step-title" className="section-title">Récapitulatif</h2>
            <dl className="cp-facts">
              <div><dt>Nom</dt><dd>{form.name.trim() || "—"}</dd></div>
              <div><dt>Occasion</dt><dd>{form.occasion === "CUSTOM" && form.occasionLabel ? form.occasionLabel : OCCASION_LABELS[form.occasion]}</dd></div>
              <div><dt>Période</dt><dd>{form.startsAt ? `Du ${formatDate(fromDateInput(form.startsAt) ?? "")}` : "Sans date de début"}{form.endsAt ? ` au ${formatDate(fromDateInput(form.endsAt, true) ?? "")}` : ""}</dd></div>
              <div><dt>Statut de la campagne</dt><dd>{STATUS_LABELS[form.status]}</dd></div>
              <div><dt>Expérience</dt><dd>{selectedQuiz?.name ?? "—"}{selectedInfo ? ` · ${selectedInfo.catalog.name}` : ""}</dd></div>
              <div><dt>Accessibilité publique du quiz</dt><dd>{selectedAccess ? selectedAccess.label : selectedQuiz?.active ? "Actif" : "—"}</dd></div>
              {selectedInfo && <div><dt>Partage</dt><dd>{sharedLabel(otherCampaigns(selectedInfo, campaignId).length)}</dd></div>}
            </dl>
            <p className="cp-muted">Aucun lien ni statistique propre à la campagne n'est créé ; l'accès public suit uniquement l'état du quiz.</p>
          </section>
        )}

        <div className="form-actions cp-form-actions">
          {step > 0 && <button type="button" className="btn-ghost" onClick={() => goTo(step - 1)}>Précédent</button>}
          <button type="button" className="btn-ghost" disabled={saving}
            onClick={() => void persist(campaignId ? form.status : "DRAFT", true)}>
            {campaignId ? "Enregistrer et quitter" : "Enregistrer en brouillon et quitter"}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {last ? (saving ? "Enregistrement…" : campaignId ? "Enregistrer" : "Créer la campagne") : "Continuer"}
          </button>
        </div>
      </form>
    </div>
  );
}
