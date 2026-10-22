import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  CampaignOccasion,
  GeneratedQuizDraft,
  QuizAxis,
  QuizDraft,
  QuizDraftAnswer,
  QuizDraftPreviewResponse,
  QuizDraftSaveResponse,
  QuizGenerationContext,
  QuizGenerationLimits,
  QuizGenerationObjective,
  QuizGenerationRequest,
} from "@poapo/types";
import { apiFetch } from "../lib/api";
import { OCCASION_LABELS, OCCASIONS, STATUS_LABELS } from "../lib/campaigns";
import {
  axisSpread,
  DISCRIMINANT_SPREAD,
  draftPayload,
  expectedMode,
  formatImpact,
  MODE_LABELS,
  OBJECTIVE_LABELS,
  OBJECTIVES,
} from "../lib/quizGeneration";
import Icon from "../components/Icon";

interface Settings {
  occasion: CampaignOccasion;
  occasionLabel: string;
  objective: QuizGenerationObjective;
  productIds: string[];
  axisKeys: string[];
  instructions: string;
  questionCount: number;
}

type GenerationMeta = Omit<GeneratedQuizDraft, "draft">;

interface StoredDraft {
  savedAt: string;
  settings: Settings;
  meta: GenerationMeta;
  draft: QuizDraft;
}

const LEAVE_MESSAGE = "Le quiz généré n'est pas enregistré. Quitter cette page et perdre vos modifications ?";
const storageKey = (campaignId: string) => `poapo:campaign-quiz-draft:${campaignId}`;

function readStored(campaignId: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(campaignId));
    const parsed = raw ? (JSON.parse(raw) as StoredDraft) : null;
    return parsed?.draft && Array.isArray(parsed.draft.questions) ? parsed : null;
  } catch {
    return null;
  }
}

/** Avertit avant de quitter la page (rechargement, fermeture, lien interne) tant que `active` est vrai. */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Le routeur n'est pas un data router (pas de useBlocker) : on intercepte les clics sur liens en phase de capture,
    // avant React Router, puis on annule la navigation si l'utilisateur ne confirme pas.
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (anchor.dataset.skipLeaveGuard !== undefined) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active]);
}

// ─── Éditeur d'impacts (mêmes bornes que le Quiz Builder) ─────────────────────

function ImpactEditor({ axes, impacts, limit, onChange }: {
  axes: QuizAxis[];
  impacts: Record<string, number>;
  limit: number;
  onChange: (impacts: Record<string, number>) => void;
}) {
  const set = (key: string, raw: number) => {
    const value = Number.isFinite(raw) ? Math.round(Math.max(-limit, Math.min(limit, raw)) * 100) / 100 : 0;
    const next = { ...impacts };
    if (value === 0) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <div className="impact-sliders">
      {axes.map((axis) => {
        const value = impacts[axis.key] ?? 0;
        return (
          <div key={axis.key} className="impact-slider-row">
            <label className="gen-impact-label" title={[axis.lowLabel, axis.highLabel].filter(Boolean).join(" ↔ ")}>{axis.label}</label>
            <input type="range" min={-limit} max={limit} step="0.01" value={value} aria-label={`Impact sur ${axis.label}`}
              onChange={(e) => set(axis.key, parseFloat(e.target.value))} style={{ flex: 1 }} />
            <input type="number" className="input-sm" min={-limit} max={limit} step="0.01" value={value.toFixed(2)} style={{ width: 84 }}
              aria-label={`Valeur de l'impact sur ${axis.label}`} onChange={(e) => set(axis.key, parseFloat(e.target.value))} />
            <span className="impact-value">{formatImpact(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignQuizGeneratorPage() {
  const { campaignId = "" } = useParams();
  const base = `/api/campaigns/${encodeURIComponent(campaignId)}/quiz-generation`;

  const [context, setContext] = useState<QuizGenerationContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const [meta, setMeta] = useState<GenerationMeta | null>(null);
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stored, setStored] = useState<StoredDraft | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [previewAnswers, setPreviewAnswers] = useState<number[]>([]);
  const [preview, setPreview] = useState<QuizDraftPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [attach, setAttach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState<QuizDraftSaveResponse | null>(null);
  const editorRef = useRef<HTMLElement>(null);

  useLeaveGuard(dirty);

  useEffect(() => {
    let cancelled = false;
    apiFetch<QuizGenerationContext>(`${base}/context`)
      .then((ctx) => {
        if (cancelled) return;
        setContext(ctx);
        setAttach(ctx.canAttach);
        setSettings({
          occasion: ctx.campaign.occasion,
          occasionLabel: ctx.campaign.occasionLabel ?? "",
          objective: "GIFT_FINDER",
          productIds: [],
          axisKeys: ctx.axes.map((axis) => axis.key),
          instructions: "",
          questionCount: 5,
        });
        setStored(readStored(campaignId));
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [base, campaignId]);

  // Sauvegarde locale du brouillon non enregistré, restaurable après un rechargement.
  useEffect(() => {
    if (!dirty || !draft || !meta || !settings) return;
    const payload: StoredDraft = { savedAt: new Date().toISOString(), settings, meta, draft };
    try {
      sessionStorage.setItem(storageKey(campaignId), JSON.stringify(payload));
    } catch {
      /* quota ou stockage désactivé : la protection beforeunload reste active */
    }
  }, [dirty, draft, meta, settings, campaignId]);

  const clearStored = useCallback(() => {
    sessionStorage.removeItem(storageKey(campaignId));
    setStored(null);
  }, [campaignId]);

  const productsById = useMemo(() => new Map(context?.products.map((product) => [product.id, product]) ?? []), [context]);
  const selectedProducts = useMemo(
    () => (settings?.productIds ?? []).map((id) => productsById.get(id)).filter((product): product is NonNullable<typeof product> => product !== undefined),
    [settings, productsById],
  );
  const draftAxes = useMemo(
    () => (context && draft ? context.axes.filter((axis) => draft.axisKeys.includes(axis.key)) : []),
    [context, draft],
  );

  if (loadError) {
    return (
      <div className="page">
        <div className="form-error" role="alert">{loadError}</div>
        <Link className="btn-ghost" to={`/campaigns/${encodeURIComponent(campaignId)}`}>Retour à la campagne</Link>
      </div>
    );
  }
  if (!context || !settings) return <div className="loading-block">Chargement...</div>;

  const limits: QuizGenerationLimits = context.limits;
  const mode = expectedMode(selectedProducts, settings.axisKeys);
  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const filteredProducts = context.products.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    return !query || `${product.name} ${product.brand ?? ""}`.toLowerCase().includes(query);
  });

  const productCountOk = settings.productIds.length >= limits.minProducts && settings.productIds.length <= limits.maxProducts;
  const settingsError =
    !context.axes.length ? "Le quiz de la campagne n'a aucun axe de recommandation : ajoutez-en depuis sa configuration."
      : !productCountOk ? `Sélectionnez entre ${limits.minProducts} et ${limits.maxProducts} produits.`
        : !settings.axisKeys.length ? "Sélectionnez au moins un axe."
          : settings.occasion === "CUSTOM" && !settings.occasionLabel.trim() ? "Nommez l'événement personnalisé."
            : !mode ? "Le moteur ne peut pas départager ces produits : renseignez leurs valeurs sur les axes ou ré-enregistrez-les depuis le catalogue pour calculer leurs embeddings."
              : "";

  const applyDraft = (next: QuizDraft) => {
    setDraft(next);
    setDirty(true);
    setPreview(null);
    setPreviewAnswers((answers) => next.questions.map((question, index) => (
      answers[index] !== undefined && answers[index] < question.answers.length ? answers[index] : -1
    )));
  };

  const generate = async () => {
    if (dirty && !window.confirm("Remplacer le quiz en cours d'édition par une nouvelle génération ?")) return;
    setGenerating(true);
    setGenerateError("");
    setSaveError("");
    try {
      const body: QuizGenerationRequest = {
        occasion: settings.occasion,
        occasionLabel: settings.occasion === "CUSTOM" ? settings.occasionLabel.trim() : null,
        objective: settings.objective,
        productIds: settings.productIds,
        axisKeys: settings.axisKeys,
        instructions: settings.instructions.trim() || null,
        questionCount: settings.questionCount,
      };
      const result = await apiFetch<GeneratedQuizDraft>(base, { method: "POST", body: JSON.stringify(body) });
      const { draft: generated, ...rest } = result;
      setMeta(rest);
      setSaved(null);
      setPreviewAnswers(generated.questions.map(() => -1));
      setPreview(null);
      setDraft(generated);
      setDirty(true);
      requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const restore = () => {
    if (!stored) return;
    setSettings(stored.settings);
    setMeta(stored.meta);
    setDraft(stored.draft);
    setPreviewAnswers(stored.draft.questions.map(() => -1));
    setPreview(null);
    setSaved(null);
    setDirty(true);
    setStored(null);
  };

  const discard = () => {
    if (!window.confirm("Abandonner ce quiz généré ? Les modifications non enregistrées seront perdues.")) return;
    setDraft(null);
    setMeta(null);
    setPreview(null);
    setDirty(false);
    clearStored();
  };

  const runPreview = async () => {
    if (!draft) return;
    setPreviewing(true);
    setPreviewError("");
    try {
      setPreview(await apiFetch<QuizDraftPreviewResponse>(`${base}/preview`, {
        method: "POST",
        body: JSON.stringify({ draft: draftPayload(draft), answers: previewAnswers }),
      }));
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await apiFetch<QuizDraftSaveResponse>(`${base}/save`, {
        method: "POST",
        body: JSON.stringify({ draft: draftPayload(draft), attachToCampaign: context.canAttach && attach }),
      });
      setSaved(result);
      setDirty(false);
      clearStored();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Édition du brouillon ───────────────────────────────────────────────────

  const editQuestion = (qi: number, patch: Partial<QuizDraft["questions"][number]>) => draft && applyDraft({
    ...draft,
    questions: draft.questions.map((question, index) => (index === qi ? { ...question, ...patch } : question)),
  });
  const editAnswer = (qi: number, ai: number, patch: Partial<QuizDraftAnswer>) => draft && editQuestion(qi, {
    answers: draft.questions[qi].answers.map((answer, index) => (index === ai ? { ...answer, ...patch } : answer)),
  });
  const moveQuestion = (qi: number, delta: number) => {
    if (!draft) return;
    const questions = [...draft.questions];
    const [moved] = questions.splice(qi, 1);
    questions.splice(qi + delta, 0, moved);
    applyDraft({ ...draft, questions });
  };

  const answeredAll = previewAnswers.length > 0 && previewAnswers.every((choice) => choice >= 0);
  const campaignPath = `/campaigns/${encodeURIComponent(campaignId)}`;

  return (
    <div className="page quiz-generator">
      <div className="page-header">
        <div>
          <Link className="table-link" to={campaignPath}>← {context.campaign.name}</Link>
          <h1 className="page-title">Générer un quiz avec l'IA</h1>
          <p className="page-subtitle">
            Basé sur les axes du quiz « {context.campaign.quizName} » et les produits du catalogue « {context.catalog.name} »{context.industry ? ` · secteur ${context.industry}` : ""}.
            Le quiz généré est enregistré comme nouveau brouillon inactif : il n'est jamais publié automatiquement.
          </p>
        </div>
      </div>

      {stored && !draft && (
        <div className="gen-banner" role="status">
          <span>Un quiz généré non enregistré a été retrouvé ({new Date(stored.savedAt).toLocaleString("fr-FR")}).</span>
          <div className="gen-banner-actions">
            <button type="button" className="btn-primary btn-sm" onClick={restore}>Restaurer</button>
            <button type="button" className="btn-ghost btn-sm" onClick={clearStored}>Ignorer</button>
          </div>
        </div>
      )}

      {/* ─── 1. Paramètres ─── */}
      <section className="form-section">
        <h2 className="section-title">1. Paramètres de génération</h2>
        <div className="form-grid">
          <div className="field-group">
            <label className="field-label" htmlFor="gen-occasion">Occasion</label>
            <select id="gen-occasion" className="field-select" value={settings.occasion}
              onChange={(e) => update({ occasion: e.target.value as CampaignOccasion })}>
              {OCCASIONS.map((occasion) => <option key={occasion} value={occasion}>{OCCASION_LABELS[occasion]}</option>)}
            </select>
          </div>
          {settings.occasion === "CUSTOM" ? (
            <div className="field-group">
              <label className="field-label" htmlFor="gen-occasion-label">Nom de l'événement</label>
              <input id="gen-occasion-label" className="field-input" maxLength={80} value={settings.occasionLabel}
                onChange={(e) => update({ occasionLabel: e.target.value })} placeholder="Ex. Anniversaire de la boutique" />
            </div>
          ) : <div />}
          <div className="field-group field-span2">
            <span className="field-label">Objectif marketing</span>
            <div className="gen-objectives" role="radiogroup" aria-label="Objectif marketing">
              {OBJECTIVES.map((objective) => (
                <label key={objective} className={`gen-objective${settings.objective === objective ? " selected" : ""}`}>
                  <input type="radio" name="objective" value={objective} checked={settings.objective === objective}
                    onChange={() => update({ objective })} />
                  <strong>{OBJECTIVE_LABELS[objective].title}</strong>
                  <span>{OBJECTIVE_LABELS[objective].hint}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="field-group">
          <div className="gen-row-between">
            <span className="field-label">Produits du catalogue « {context.catalog.name} » ({settings.productIds.length} / {limits.maxProducts})</span>
            <div className="gen-row">
              <input className="field-input gen-search" type="search" placeholder="Rechercher un produit" value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)} aria-label="Rechercher un produit" />
              {settings.productIds.length > 0 && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => update({ productIds: [] })}>Tout désélectionner</button>
              )}
            </div>
          </div>
          {context.products.length === 0 ? (
            <p className="text-muted">Aucun produit actif dans le catalogue « {context.catalog.name} ».</p>
          ) : (
            <div className="gen-products">
              {filteredProducts.map((product) => {
                const checked = settings.productIds.includes(product.id);
                const full = !checked && settings.productIds.length >= limits.maxProducts;
                return (
                  <label key={product.id} className={`gen-product${checked ? " selected" : ""}${full ? " disabled" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={full} onChange={(e) => update({
                      productIds: e.target.checked ? [...settings.productIds, product.id] : settings.productIds.filter((id) => id !== product.id),
                    })} />
                    {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="gen-product-placeholder"><Icon name="box" size={16} /></span>}
                    <span className="gen-product-body">
                      <span className="gen-product-name">{product.name}</span>
                      <span className="gen-product-meta">
                        {product.brand && <span>{product.brand}</span>}
                        {product.price !== null && <span>{product.price.toFixed(2)} €</span>}
                      </span>
                      <span className="campaign-chips">
                        {context.axes.filter((axis) => product.axisValues[axis.key] !== undefined).map((axis) => (
                          <span key={axis.key} className="campaign-chip">{axis.label} {product.axisValues[axis.key].toFixed(2)}</span>
                        ))}
                        {!Object.keys(product.axisValues).length && <span className="campaign-chip chip-warning">Aucune valeur d'axe</span>}
                        {!product.hasEmbedding && <span className="campaign-chip chip-warning">Sans embedding</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
              {filteredProducts.length === 0 && <p className="text-muted">Aucun produit ne correspond à la recherche.</p>}
            </div>
          )}
          {context.products.length >= 500 && <p className="field-hint">Seuls les 500 premiers produits actifs (mis en avant, puis par nom) sont listés.</p>}
        </div>

        <div className="field-group">
          <span className="field-label">Axes de recommandation utilisés</span>
          <p className="field-hint">Seuls les axes du quiz de la campagne sont disponibles. Un axe départage les produits sélectionnés lorsque leurs valeurs s'écartent d'au moins {DISCRIMINANT_SPREAD.toFixed(1)}.</p>
          <div className="gen-axes">
            {context.axes.map((axis) => {
              const stats = axisSpread(selectedProducts, axis.key);
              const discriminant = stats.valued >= 2 && stats.spread >= DISCRIMINANT_SPREAD - 1e-9;
              return (
                <label key={axis.key} className="checkbox-label">
                  <input type="checkbox" checked={settings.axisKeys.includes(axis.key)} onChange={(e) => update({
                    axisKeys: e.target.checked
                      ? context.axes.map((a) => a.key).filter((key) => key === axis.key || settings.axisKeys.includes(key))
                      : settings.axisKeys.filter((key) => key !== axis.key),
                  })} />
                  {axis.label}
                  {selectedProducts.length >= 2 && (
                    <span className={`campaign-chip${discriminant ? "" : " chip-warning"}`}>
                      {stats.valued < 2 ? "Peu de valeurs" : `Écart ${stats.spread.toFixed(2)}`}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          {selectedProducts.length >= limits.minProducts && mode && (
            <p className="field-hint">
              Mode prévu : <strong>{MODE_LABELS[mode]}</strong>
              {mode === "SEMANTIC" && " — aucun axe ne distingue nettement ces produits ; le moteur s'appuiera sur la similarité entre le profil et les descriptions produits."}
            </p>
          )}
        </div>

        <div className="form-grid">
          <div className="field-group">
            <label className="field-label" htmlFor="gen-count">Nombre de questions</label>
            <select id="gen-count" className="field-select" value={settings.questionCount}
              onChange={(e) => update({ questionCount: Number(e.target.value) })}>
              {Array.from({ length: limits.maxQuestions - limits.minQuestions + 1 }, (_, i) => limits.minQuestions + i).map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </div>
          <div />
          <div className="field-group field-span2">
            <label className="field-label" htmlFor="gen-instructions">Instructions pour l'IA (facultatif)</label>
            <textarea id="gen-instructions" className="field-textarea" rows={3} maxLength={limits.instructions} value={settings.instructions}
              onChange={(e) => update({ instructions: e.target.value })}
              placeholder="Ex. Ton chaleureux, tutoiement, parler de cadeaux à offrir en famille" />
            <span className="field-hint">{settings.instructions.length} / {limits.instructions}</span>
          </div>
        </div>

        {generateError && <div className="form-error" role="alert">{generateError}</div>}
        {settingsError && <p className="field-hint gen-blocking">{settingsError}</p>}
        <div className="form-actions">
          <button type="button" className="btn-primary" disabled={generating || Boolean(settingsError)} onClick={() => void generate()}>
            {generating ? "Génération en cours… (jusqu'à une minute)" : draft ? "Régénérer" : "Générer le quiz"}
          </button>
        </div>
      </section>

      {/* ─── 2. Brouillon ─── */}
      {draft && meta && (
        <section className="form-section" ref={editorRef}>
          <div className="gen-row-between">
            <h2 className="section-title">2. Quiz généré — à relire et modifier</h2>
            <span className={`campaign-badge ${meta.mode === "AXES" ? "status-active" : "status-scheduled"}`}>{MODE_LABELS[meta.mode]}</span>
          </div>

          <div className="gen-savebar">
            <div className="gen-savebar-text">
              {saved && !dirty ? (
                <span>
                  ✅ Quiz « {saved.quizName} » enregistré comme brouillon inactif ({saved.questionCount} questions, {saved.answerCount} réponses).
                  {saved.attachedToCampaign && " Il est désormais associé à la campagne."}
                  {saved.attachMessage && ` ${saved.attachMessage}`}
                </span>
              ) : (
                <span>{saved ? "Modifié depuis le dernier enregistrement : un nouvel enregistrement créera un autre quiz." : "Non enregistré."}</span>
              )}
              {saved && !dirty ? null : context.canAttach ? (
                <label className="checkbox-label">
                  <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                  Associer le quiz enregistré à cette campagne (brouillon)
                </label>
              ) : (
                <span className="field-hint">
                  Campagne « {STATUS_LABELS[context.campaign.effectiveStatus]} » : le quiz enregistré restera indépendant de la campagne.
                </span>
              )}
            </div>
            <div className="gen-row">
              {saved && !dirty ? (
                <>
                  <Link className="btn-primary" to={`/quiz-builder?quizId=${encodeURIComponent(saved.quizId)}`}>Ouvrir dans le Quiz Builder</Link>
                  <Link className="btn-ghost" to={`/quizzes/${encodeURIComponent(saved.quizId)}`}>Configurer le quiz</Link>
                </>
              ) : (
                <>
                  <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
                    {saving ? "Enregistrement…" : "Enregistrer comme brouillon"}
                  </button>
                  <button type="button" className="btn-ghost" disabled={saving} onClick={discard}>Abandonner</button>
                </>
              )}
            </div>
          </div>
          {saveError && <div className="form-error" role="alert">{saveError}</div>}

          {meta.warnings.length > 0 && (
            <ul className="gen-warnings">
              {meta.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          )}

          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="draft-name">Nom interne du quiz</label>
              <input id="draft-name" className="field-input" maxLength={120} value={draft.name} onChange={(e) => applyDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="draft-title">Titre affiché</label>
              <input id="draft-title" className="field-input" maxLength={120} value={draft.quizTitle} onChange={(e) => applyDraft({ ...draft, quizTitle: e.target.value })} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="draft-cta">Texte du bouton</label>
              <input id="draft-cta" className="field-input" maxLength={60} value={draft.ctaText} onChange={(e) => applyDraft({ ...draft, ctaText: e.target.value })} />
            </div>
          </div>
          <p className="field-hint">
            Impacts proposés par l'IA limités à ±{limits.generationImpact.toFixed(2)} ; vous pouvez les ajuster jusqu'à ±{limits.manualImpact}, comme dans le Quiz Builder.
          </p>

          {draft.questions.map((question, qi) => (
            <div key={qi} className="gen-question">
              <div className="gen-row-between">
                <strong>Question {qi + 1}</strong>
                <div className="gen-row">
                  <button type="button" className="btn-icon" title="Monter" disabled={qi === 0} onClick={() => moveQuestion(qi, -1)}>↑</button>
                  <button type="button" className="btn-icon" title="Descendre" disabled={qi === draft.questions.length - 1} onClick={() => moveQuestion(qi, 1)}>↓</button>
                  <button type="button" className="btn-icon btn-icon--danger" title="Supprimer la question" disabled={draft.questions.length <= 1}
                    onClick={() => applyDraft({ ...draft, questions: draft.questions.filter((_, index) => index !== qi) })}>🗑</button>
                </div>
              </div>
              <input className="field-input" maxLength={300} aria-label={`Texte de la question ${qi + 1}`} value={question.text}
                onChange={(e) => editQuestion(qi, { text: e.target.value })} />
              <input className="field-input" maxLength={300} placeholder="Texte d'aide (facultatif)" aria-label={`Aide de la question ${qi + 1}`}
                value={question.helpText ?? ""} onChange={(e) => editQuestion(qi, { helpText: e.target.value })} />

              {question.answers.map((answer, ai) => (
                <div key={ai} className="answer-edit-form">
                  <div className="answer-edit-row">
                    <input className="input-sm" style={{ width: 60 }} maxLength={16} placeholder="Emoji" aria-label="Emoji" value={answer.emoji ?? ""}
                      onChange={(e) => editAnswer(qi, ai, { emoji: e.target.value })} />
                    <input className="input-sm" style={{ flex: 1 }} maxLength={150} aria-label={`Réponse ${ai + 1}`} value={answer.text}
                      onChange={(e) => editAnswer(qi, ai, { text: e.target.value })} />
                    <button type="button" className="btn-icon btn-icon--danger" title="Supprimer la réponse" disabled={question.answers.length <= limits.minAnswers}
                      onClick={() => editQuestion(qi, { answers: question.answers.filter((_, index) => index !== ai) })}>🗑</button>
                  </div>
                  <ImpactEditor axes={draftAxes} impacts={answer.impacts} limit={limits.manualImpact}
                    onChange={(impacts) => editAnswer(qi, ai, { impacts })} />
                  {answer.targetProductIds && answer.targetProductIds.length > 0 && (
                    <p className="field-hint">
                      Vise : {answer.targetProductIds.map((id) => productsById.get(id)?.name ?? "produit retiré").join(", ")} (indicatif)
                    </p>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost btn-sm" disabled={question.answers.length >= limits.maxAnswers}
                onClick={() => editQuestion(qi, { answers: [...question.answers, { text: "", emoji: null, impacts: {} }] })}>
                + Ajouter une réponse
              </button>
            </div>
          ))}
          <button type="button" className="btn-ghost" disabled={draft.questions.length >= limits.maxDraftQuestions}
            onClick={() => applyDraft({
              ...draft,
              questions: [...draft.questions, { text: "", helpText: null, answers: [{ text: "", emoji: null, impacts: {} }, { text: "", emoji: null, impacts: {} }] }],
            })}>
            + Ajouter une question
          </button>
          <p className="field-hint">Généré par {meta.generation.model || "le service IA"} en {(meta.generation.durationMs / 1000).toFixed(1)} s ({meta.generation.attempts} tentative{meta.generation.attempts > 1 ? "s" : ""}).</p>
        </section>
      )}

      {/* ─── 3. Aperçu ─── */}
      {draft && (
        <section className="form-section">
          <h2 className="section-title">3. Aperçu interactif</h2>
          <p className="section-hint">Répondez comme un client : POAPO interroge une fois le moteur de recommandation, limité aux produits sélectionnés. Rien n'est enregistré.</p>
          {draft.questions.map((question, qi) => (
            <div key={qi} className="gen-preview-question">
              <strong>{question.text || `Question ${qi + 1}`}</strong>
              <div className="gen-preview-answers">
                {question.answers.map((answer, ai) => (
                  <button key={ai} type="button" className={`gen-preview-answer${previewAnswers[qi] === ai ? " selected" : ""}`}
                    aria-pressed={previewAnswers[qi] === ai}
                    onClick={() => {
                      setPreview(null);
                      setPreviewAnswers((current) => current.map((choice, index) => (index === qi ? ai : choice)));
                    }}>
                    {answer.emoji && <span>{answer.emoji}</span>} {answer.text || `Réponse ${ai + 1}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {previewError && <div className="form-error" role="alert">{previewError}</div>}
          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={!answeredAll || previewing} onClick={() => void runPreview()}>
              {previewing ? "Recommandation…" : "Voir la recommandation"}
            </button>
          </div>
          {preview && (
            <div className="gen-preview-result">
              <div className="gen-preview-products">
                {preview.recommendations.map((item, index) => (
                  <div key={item.product.id} className={`gen-preview-product${index === 0 ? " top" : ""}`}>
                    {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" /> : <span className="gen-product-placeholder"><Icon name="box" /></span>}
                    <div>
                      <strong>{index === 0 ? "Recommandé : " : ""}{item.product.name}</strong>
                      <span className="field-hint">{item.product.brand ?? ""}{item.product.price !== null ? ` · ${item.product.price.toFixed(2)} €` : ""} · score {item.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="campaign-chips">
                {draftAxes.map((axis) => (
                  <span key={axis.key} className="campaign-chip">{axis.label} {(preview.profile[axis.key] ?? 0.5).toFixed(2)}</span>
                ))}
              </div>
              {preview.explanation.length > 0 && (
                <ul className="gen-explanation">{preview.explanation.map((line, index) => <li key={index}>{line}</li>)}</ul>
              )}
            </div>
          )}
          {!saved || dirty ? (
            <p className="field-hint">Pensez à enregistrer le quiz comme brouillon pour conserver vos modifications.</p>
          ) : null}
          {preview && draft.questions.some((q) => q.answers.some((a) => !Object.keys(a.impacts).length)) && (
            <p className="field-hint">Certaines réponses n'ont aucun impact : elles ne modifient pas le profil.</p>
          )}
        </section>
      )}
    </div>
  );
}
