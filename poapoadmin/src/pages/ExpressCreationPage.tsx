import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  ExpressDraft, ExpressPreviewResponse, ExpressProposal, ExpressQuestionCount, ExpressSaveResponse, ExpressSector, ExpressValidation,
  ProductEnrichmentApplyInput, ProductEnrichmentApplyResponse, ProductEnrichmentEstimateInput, ProductEnrichmentEstimateResponse,
} from "@poapo/types";
import { ApiError, apiFetch } from "../lib/api";
import LocalEstimateRow from "../components/LocalEstimateRow";
import { readinessState, readinessText, useEmbeddingReadiness } from "../lib/embeddingReadiness";
import { buildUpdates, defaultDecision, hasExistingValue, summarizeUpdates, type ProductDecisions } from "../lib/productEnrichment";
import { useCatalogs } from "../lib/catalogs";
import { experienceEditorPath } from "../lib/experienceLinks";
import {
  addAnswer, removeAnswer, removeAxis, renameAxis, replaceQuestion, setImpact, updateAnswer, updateQuestion,
} from "../lib/expressDraft";
import "../components/quizEditor/experienceEditor.css";
import "../components/quizEditor/experienceWizard.css";

type Step = "setup" | "criteria" | "features" | "questions" | "preview" | "save";
/** Trois étapes visibles pour le commerçant ; les écrans détaillés existants se regroupent sous « Préparer votre quiz ». */
const PHASES: { label: string; steps: Step[] }[] = [
  { label: "Ajouter vos produits", steps: ["setup"] },
  { label: "Préparer votre quiz", steps: ["criteria", "features", "questions", "preview"] },
  { label: "Publier", steps: ["save"] },
];
const SUBSTEPS: { id: Step; label: string }[] = [
  { id: "criteria", label: "Critères" }, { id: "features", label: "Caractéristiques" }, { id: "questions", label: "Questions" }, { id: "preview", label: "Aperçu" },
];
const SECTORS: { id: ExpressSector; label: string }[] = [
  { id: "coffee", label: "Café" }, { id: "perfume", label: "Parfum" }, { id: "travel", label: "Voyage" }, { id: "fashion", label: "Mode" },
];
const KIND_LABELS = {
  axis: "Préférence progressive", choice: "Choix parmi vos produits", budget: "Budget", yesno: "Oui / non", measure: "Mesure de vos produits",
} as const;
const RELIABILITY = {
  reliable: { badge: "badge badge-active", label: "Données suffisantes" },
  limited: { badge: "badge badge-featured", label: "Recommandations approximatives" },
  insufficient: { badge: "badge badge-inactive", label: "Recommandations non fiables" },
} as const;

/** Création express : analyse du catalogue, brouillon déterministe modifiable, aperçu réel, enregistrement en brouillon inactif. */
export default function ExpressCreationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { catalogs, loading, error: catalogsError } = useCatalogs();
  const [chosen, setChosen] = useState(params.get("catalogId") ?? "");
  const [sector, setSector] = useState<ExpressSector | "">("");
  const [questionCount, setQuestionCount] = useState<ExpressQuestionCount | 0>(0);
  const [step, setStep] = useState<Step>("setup");
  const [advanced, setAdvanced] = useState(false);
  const [proposal, setProposal] = useState<ExpressProposal | null>(null);
  const [draft, setDraft] = useState<ExpressDraft | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [validation, setValidation] = useState<ExpressValidation | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [preview, setPreview] = useState<ExpressPreviewResponse | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localEst, setLocalEst] = useState<ProductEnrichmentEstimateResponse | null>(null);
  const [featDecisions, setFeatDecisions] = useState<Record<string, ProductDecisions>>({});
  const [featSaved, setFeatSaved] = useState("");
  const [featError, setFeatError] = useState("");
  const [leaveAfterSave, setLeaveAfterSave] = useState(false);
  // Questions avancées (catégories, budget) : proposées seulement si le serveur les a activées.
  const [advancedAvailable, setAdvancedAvailable] = useState(false);
  const [advancedQuestions, setAdvancedQuestions] = useState(true);
  const [strictBudget, setStrictBudget] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch<{ universal: boolean }>("/api/express-quiz/capabilities").then((c) => { if (alive) setAdvancedAvailable(!!c.universal); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const useAdvanced = advancedAvailable && advancedQuestions;
  const confirmStrict = useAdvanced && strictBudget && !!draft?.questions.some((q) => q.info?.strict);

  const catalogId = catalogs.length === 1 ? catalogs[0].id : catalogs.some((item) => item.id === chosen) ? chosen : "";
  const axisLabel = useMemo(() => new Map((draft?.axes ?? []).map((axis) => [axis.key, axis.label])), [draft]);
  const reliability = validation?.reliability ?? proposal?.analysis.reliability ?? "insufficient";
  const { readiness, refresh: refreshReadiness, retry: retryReadiness } = useEmbeddingReadiness(catalogId, step !== "setup");
  const ready = readinessState(readiness);
  const selectedCatalog = catalogs.find((item) => item.id === catalogId);
  const noProducts = !!selectedCatalog && selectedCatalog.activeProductCount === 0;

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try { return await task(); } catch (err) { setError(err instanceof Error ? err.message : "L'opération a échoué"); return null; } finally { setBusy(false); }
  }

  async function analyse(exclude: string[] = excluded, model: ExpressSector | "" = sector) {
    if (!catalogId) { setError("Choisissez un catalogue."); return; }
    const result = await run(() => apiFetch<ExpressProposal>("/api/express-quiz/analyze", {
      method: "POST",
      body: JSON.stringify({ catalogId, ...(model && { sector: model }), ...(questionCount && { questionCount }), ...(exclude.length && { exclude }), ...(useAdvanced && { generator: "universal", strictBudget }) }),
    }));
    if (!result) return;
    setProposal(result);
    setDraft(result.draft);
    setExcluded(exclude);
    setPicks(result.draft ? result.draft.questions.map(() => 0) : []);
    setValidation(null);
    setPreview(null);
    setNotice("");
    setLocalEst(null);
    setFeatSaved("");
    setStep("criteria");
  }

  function edit(next: ExpressDraft) {
    setDraft(next);
    setValidation(null);
    setPreview(null);
    setPicks(next.questions.map((_, i) => Math.min(picks[i] ?? 0, next.questions[i].answers.length - 1)));
  }

  function dropCriterion(key: string) {
    if (!draft) return;
    const { draft: next, removedQuestions } = removeAxis(draft, key);
    edit(next);
    setNotice(removedQuestions ? `${removedQuestions} question(s) qui n'avaient plus d'effet ont été retirées avec ce critère.` : "");
  }

  async function validate(): Promise<ExpressValidation | null> {
    if (!draft) return null;
    const result = await run(() => apiFetch<ExpressValidation>("/api/express-quiz/validate", { method: "POST", body: JSON.stringify({ catalogId, draft, strictConfirmed: confirmStrict }) }));
    if (result) setValidation(result);
    return result;
  }

  async function goPreview() {
    if (await validate()) setStep("preview");
  }

  // Estimation locale (règles, sans IA) sur les critères du brouillon : lecture seule, rien n'est écrit.
  async function loadFeatures(): Promise<boolean> {
    if (!draft) return false;
    const input: ProductEnrichmentEstimateInput = {
      axes: draft.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel })), axisKeys: draft.axes.map((axis) => axis.key),
    };
    const result = await run(() => apiFetch<ProductEnrichmentEstimateResponse>(`/api/catalogs/${catalogId}/enrichment/estimate-local`, { method: "POST", body: JSON.stringify(input) }));
    if (!result) return false;
    setLocalEst(result);
    setFeatError("");
    setFeatDecisions(Object.fromEntries(result.results.map((r) => [r.productId, Object.fromEntries(r.estimates.map((e) => [e.axis, defaultDecision(e, hasExistingValue(undefined, r, e.axis))]))])));
    return true;
  }

  async function goFeatures() {
    setFeatSaved("");
    if (await loadFeatures()) setStep("features");
  }

  const featUpdates = useMemo(() => localEst ? buildUpdates(localEst.results, featDecisions, new Map()) : [], [localEst, featDecisions]);

  // Enregistrement explicite des seules valeurs cochées : applyEnrichment (expected / overwrite / verrou optimiste).
  async function saveFeatures() {
    if (!draft || !featUpdates.length) return;
    setBusy(true);
    setFeatError("");
    try {
      const input: ProductEnrichmentApplyInput = { axes: draft.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel })), updates: featUpdates };
      const response = await apiFetch<ProductEnrichmentApplyResponse>(`/api/catalogs/${catalogId}/enrichment/apply`, { method: "POST", body: JSON.stringify(input) });
      setFeatSaved(`${response.added} caractéristique(s) enregistrée(s) sur ${response.updatedProducts} produit(s). La préparation des recommandations est relancée.`);
      refreshReadiness();
      await loadFeatures();
      await validate();
    } catch (err) {
      setFeatError(err instanceof ApiError && err.status === 409
        ? `${err.message.replace(/\.?$/, ".")} Rien n'a été enregistré : relancez l'analyse pour voir les valeurs actuelles.`
        : err instanceof Error ? err.message : "L'enregistrement a échoué");
    } finally { setBusy(false); }
  }

  async function recommend() {
    const result = await run(() => apiFetch<ExpressPreviewResponse>("/api/express-quiz/preview", { method: "POST", body: JSON.stringify({ catalogId, draft, answers: picks, strictConfirmed: confirmStrict }) }));
    if (result) setPreview(result);
  }

  /** Enregistre le brouillon (inactif). `later` : on quitte le parcours et on reprendra depuis « Mes quiz ». */
  async function save(later = false) {
    const result = await run(() => apiFetch<ExpressSaveResponse>("/api/express-quiz/save", {
      method: "POST", body: JSON.stringify({ catalogId, draft, acknowledgeLimits: acknowledge, strictConfirmed: confirmStrict }),
    }));
    if (result) navigate(experienceEditorPath(result.quizId, later ? undefined : "publication"), { replace: true });
  }

  function saveLater() {
    if (reliability !== "reliable" && !acknowledge) {
      setLeaveAfterSave(true); setStep("save");
      setNotice("Cochez la confirmation ci-dessous, puis enregistrez le brouillon : vous pourrez le reprendre plus tard depuis « Mes quiz ».");
      return;
    }
    void save(true);
  }

  const nav = (prev: Step | null, next: (() => void) | null, nextLabel = "Continuer →", later = true, flat = false) => <div className={`xw-footer${flat ? " xw-footer--flat" : ""}`}>
    {prev ? <button type="button" className="btn-ghost" onClick={() => setStep(prev)}>← Retour</button> : <Link className="btn-ghost" to="/quizzes">Quitter</Link>}
    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {later && <button type="button" className="btn-ghost" disabled={busy} onClick={saveLater}>Enregistrer et reprendre plus tard</button>}
      {next && <button type="button" className="btn-primary" disabled={busy} onClick={next}>{busy ? "Patientez…" : nextLabel}</button>}
    </span>
  </div>;

  return <div className="page experience-editor xw-create">
    <Link className="table-link" to="/quizzes">← Mes quiz</Link>
    <h1 className="page-title">Créer une expérience</h1>
    <ol className="xw-phases" aria-label="Votre parcours">{PHASES.map((phase, index) => {
      const current = PHASES.findIndex((item) => item.steps.includes(step));
      return <li key={phase.label} className={index < current ? "done" : undefined} aria-current={index === current ? "step" : undefined}>
        <span className="xw-phase-number" aria-hidden="true">{index < current ? "✓" : index + 1}</span>{phase.label}</li>;
    })}</ol>
    {PHASES[1].steps.includes(step) && <p className="xe-muted" aria-label="Détail de l'étape">{SUBSTEPS.map((item, index) =>
      <span key={item.id} style={{ fontWeight: item.id === step ? 700 : 400 }}>{index ? " · " : ""}{item.label}</span>)}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="section-hint" role="status">{notice}</p>}

    {step === "setup" && <section className="xw-card">
      <h2 className="section-title">1. Vos produits</h2>
      {loading && <div className="loading-block" role="status">Chargement de vos catalogues…</div>}
      {catalogsError && <p className="form-error" role="alert">{catalogsError}</p>}
      {noProducts && <p className="section-hint" role="status">Ce catalogue ne contient encore aucun produit actif. <Link to="/catalog">Ajoutez vos produits</Link> (import d'un fichier ou saisie), puis revenez ici.</p>}
      {catalogs.length === 1 && <p>Catalogue « {catalogs[0].name} » ({catalogs[0].activeProductCount} produit(s) actif(s)), sélectionné automatiquement.</p>}
      {catalogs.length > 1 && catalogs.map((catalog) => <label key={catalog.id} className="xw-radio">
        <input type="radio" name="catalog" checked={catalogId === catalog.id} onChange={() => setChosen(catalog.id)} />
        <span><strong>{catalog.name}</strong><br /><span className="xe-muted">{catalog.activeProductCount} produit(s) actif(s)</span></span>
      </label>)}
      <div className="field-group">
        <label className="field-label" htmlFor="express-sector">Modèle de départ</label>
        <select id="express-sector" className="field-input" value={sector} onChange={(e) => setSector(e.target.value as ExpressSector)}>
          <option value="">Automatique (d'après mes produits)</option>
          {SECTORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value="generic">Aucun (uniquement mes données)</option>
        </select>
        <p className="field-hint">Le modèle propose des critères et des questions types ; seuls ceux qui correspondent à vos produits sont considérés comme fiables.</p>
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="express-count">Nombre de questions</label>
        <select id="express-count" className="field-input" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value) as ExpressQuestionCount | 0)}>
          <option value={0}>Automatique</option><option value={3}>3 — rapide</option><option value={5}>5 — équilibré</option><option value={7}>7 — précis</option>
        </select>
      </div>
      {advancedAvailable && <div className="field-group">
        <label className="xw-radio"><input type="checkbox" checked={advancedQuestions} onChange={(e) => setAdvancedQuestions(e.target.checked)} />
          <span><strong>Questions avancées (bêta)</strong><br /><span className="xe-muted">POAPO pose aussi des questions sur les catégories de vos produits et sur le budget, d'après les informations réellement présentes dans votre catalogue.</span></span></label>
        {advancedQuestions && <label className="xw-radio"><input type="checkbox" checked={strictBudget} onChange={(e) => setStrictBudget(e.target.checked)} />
          <span><strong>Budget maximum strict</strong><br /><span className="xe-muted">Si le visiteur choisit un plafond, aucun produit au-dessus ne lui sera jamais proposé. Sans cette case, le budget est seulement une préférence : les produits hors budget restent possibles s'ils correspondent mieux au reste de ses réponses. Disponible seulement si les prix de vos produits sont assez complets.</span></span></label>}
      </div>}
      <p className="section-hint">POAPO lit vos produits et prépare un brouillon modifiable. Rien n'est publié et aucun produit n'est modifié.</p>
      <div className="xw-footer">
        <Link className="btn-ghost" to="/quizzes">Quitter</Link>
        <button type="button" className="btn-primary" disabled={busy || !catalogId || noProducts} onClick={() => void analyse([])}>{busy ? "Analyse…" : "Analyser mon catalogue →"}</button>
      </div>
    </section>}

    {step !== "setup" && proposal && <section className="xw-card" aria-label="Analyse du catalogue">
      <p>{ready === "ready"
        ? <span className={RELIABILITY[reliability].badge}>{RELIABILITY[reliability].label}</span>
        : <span className="badge badge-inactive">{ready === "failed" ? "Préparation à relancer" : "Préparation des recommandations en cours"}</span>}{" "}
        <span className="xe-muted">{proposal.analysis.productCount} produit(s) · secteur {proposal.analysis.sectorDetected ? "détecté" : "choisi"} : {proposal.analysis.sectorLabel}</span></p>
      {[...proposal.analysis.messages, ...(validation?.warnings ?? [])].map((message, i) => <p key={i} className="section-hint">⚠ {message}</p>)}
      <p className="section-hint" role="status" data-testid="express-readiness">{readinessText(readiness)}
        {ready === "failed" && <> <button type="button" className="table-link" onClick={() => void retryReadiness()}>Relancer la préparation</button></>}</p>
      {reliability !== "reliable" && <p className="section-hint">Pour fiabiliser : complétez les caractéristiques de vos produits à l'étape « Caractéristiques » ou dans <Link to="/enrichment">Enrichissement</Link>.</p>}
    </section>}

    {step === "criteria" && proposal && <section className="xw-card">
      <h2 className="section-title">2. Critères de recommandation</h2>
      {!draft && <div data-testid="express-no-draft">
        <p>Aucune proposition honnête n'est possible avec ces données : POAPO n'a reconnu aucun secteur et vos produits n'ont pas de caractéristiques chiffrées.</p>
        <p className="section-hint">Choisissez le modèle qui correspond à votre activité : les critères et questions types seront proposés (seuls ceux utiles à vos produits sont considérés fiables).</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{SECTORS.map((item) => <button key={item.id} type="button" className="btn-ghost" disabled={busy}
          onClick={() => { setSector(item.id); void analyse(excluded, item.id); }}>Utiliser le modèle {item.label}</button>)}</div>
        <p className="section-hint">Ou <Link to="/enrichment">renseignez les caractéristiques de vos produits</Link> dans Enrichissement, puis relancez l'analyse.</p>
      </div>}
      {draft && proposal.analysis.generator === "universal" && proposal.analysis.criteria && <div data-testid="express-criteria-summary">
        <p className="section-hint">POAPO a examiné toutes les caractéristiques de votre catalogue et retenu celles qui permettent de départager vos produits.</p>
        {(["used", "to_validate", "left_out"] as const).map((status) => {
          const items = proposal.analysis.criteria!.filter((item) => item.status === status);
          if (!items.length) return null;
          const title = { used: "Utilisés dans le quiz", to_validate: "À valider avant de les demander aux visiteurs", left_out: "Non utilisés" }[status];
          return <div key={status}><h3 className="field-label">{title}</h3><ul>{items.map((item) => <li key={item.label}><strong>{item.label}</strong> <span className="xe-muted">— {KIND_LABELS[item.kind]} · {item.reason}</span></li>)}</ul></div>;
        })}
      </div>}
      {draft && <>
        <p className="section-hint">Ce sont les caractéristiques qui comparent vos produits aux réponses des visiteurs.</p>
        {draft.axes.map((axis) => <div key={axis.key} className="xw-radio" style={{ flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
            <input className="field-input" aria-label={`Nom du critère ${axis.label}`} value={axis.label} maxLength={60}
              onChange={(e) => edit(renameAxis(draft, axis.key, e.target.value))} style={{ flex: "1 1 180px" }} />
            <button type="button" className="btn-ghost" disabled={draft.axes.length <= 1 && proposal.analysis.generator !== "universal"} onClick={() => dropCriterion(axis.key)}>Supprimer</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void analyse([...excluded, axis.key])}>Remplacer</button>
          </div>
          <span className="xe-muted">{axis.description}</span>
          <span className="xe-muted">{axis.justification}</span>
          {axis.evidence === "semantic" && <span className="badge badge-inactive">Non renseigné sur vos produits</span>}
          {advanced && <span className="xe-muted">Identifiant : {axis.key} · échelle 0–1 (neutre 0,5) · {axis.lowLabel ?? "—"} → {axis.highLabel ?? "—"}</span>}
        </div>)}
        <p className="field-hint">« Remplacer » relance l'analyse sans ce critère : les questions sont régénérées et vos modifications de questions sont perdues.</p>
        {proposal.analysis.missingForSector.length > 0 && <p className="section-hint">Critères habituels absents de vos données : {proposal.analysis.missingForSector.map((m) => m.label).join(", ")}.</p>}
      </>}
      {nav("setup", draft ? () => void goFeatures() : null, "Continuer →", !!draft)}
    </section>}

    {step === "features" && draft && localEst && <section className="xw-card" data-testid="express-features">
      <h2 className="section-title">3. Caractéristiques de vos produits</h2>
      <p className="section-hint">Pour comparer vos produits aux réponses des visiteurs, chaque critère doit être renseigné sur vos produits. POAPO propose des valeurs d'après les mots de vos fiches (sans IA) : rien n'est enregistré sans votre accord, et vous pouvez continuer sans rien enregistrer.</p>
      {localEst.warnings.map((message) => <p key={message} className="section-hint" role="status">ℹ {message}</p>)}
      {(() => {
        const supported = new Set(localEst.supportedAxes ?? []);
        const unsupported = draft.axes.filter((axis) => !supported.has(axis.key));
        const groups = draft.axes.filter((axis) => supported.has(axis.key)).map((axis) => ({
          axis,
          items: localEst.results.flatMap((result) => { const estimate = result.estimates.find((e) => e.axis === axis.key && e.status === "estimated"); return estimate ? [{ result, estimate }] : []; }),
        })).filter((group) => group.items.length > 0);
        const total = groups.reduce((sum, group) => sum + group.items.length, 0);
        const weak = groups.reduce((sum, group) => sum + group.items.filter((item) => item.estimate.confidence === "low").length, 0);
        const chosen = summarizeUpdates(featUpdates).added;
        const setDecisions = (pick: (axis: string, confidence: string | null) => boolean | null) => setFeatDecisions((previous) => Object.fromEntries(Object.entries(previous).map(([id, axes]) => [id, Object.fromEntries(Object.entries(axes).map(([key, d]) => {
          const estimate = localEst.results.find((r) => r.productId === id)?.estimates.find((e) => e.axis === key);
          const next = estimate && estimate.status === "estimated" ? pick(key, estimate.confidence) : null;
          return [key, next === null ? d : { ...d, accepted: next }];
        }))])));
        // Sélection groupée : uniquement les propositions fiables (confiance moyenne ou élevée) ; les faibles ne sont jamais cochées d'office.
        const reliable = (axis: string | null) => (key: string, confidence: string | null) => (axis === null || key === axis) && confidence !== "low" ? true : null;
        return <>
          {supported.size > 0 && unsupported.length > 0 && <p className="section-hint">Pas de règle automatique pour : {unsupported.map((axis) => axis.label).join(", ")}. Ces critères restent à renseigner à la main dans <Link to="/enrichment">Enrichissement</Link>.</p>}
          {supported.size > 0 && total === 0 && <p>Aucune nouvelle caractéristique à proposer : vos fiches ne contiennent pas d'indice exploitable, ou les valeurs existent déjà.</p>}
          {total > 0 && <>
            <p className="feat-summary" role="status" data-testid="feat-summary"><strong>{localEst.results.length} produit(s) analysé(s)</strong> · {total} proposition(s) dans {groups.length} critère(s) · <strong>{chosen} validée(s)</strong>{weak > 0 && <> · {weak} à confiance faible (à cocher une par une)</>}</p>
            <div className="feat-bulk">
              <button type="button" className="btn-ghost" disabled={busy} data-testid="feat-validate-reliable" onClick={() => setDecisions(reliable(null))}>Valider toutes les propositions fiables</button>
              <button type="button" className="btn-ghost" disabled={busy || !featUpdates.length} data-testid="feat-ignore-all" onClick={() => setDecisions(() => false)}>Tout ignorer</button>
            </div>
            {groups.map(({ axis, items }, index) => {
              const picked = items.filter((item) => featDecisions[item.result.productId]?.[axis.key]?.accepted).length;
              const reliableCount = items.filter((item) => item.estimate.confidence !== "low").length;
              const low = items.length - reliableCount;
              return <details key={axis.key} className="feat-group" open={index === 0} data-testid={`feat-group-${axis.key}`}>
                <summary><strong>{axis.label}</strong> — {items.length} proposition(s) · {picked} validée(s){low > 0 && ` · ${low} faible(s)`}</summary>
                <div className="feat-bulk">
                  <button type="button" className="btn-ghost" disabled={busy || !reliableCount} onClick={() => setDecisions(reliable(axis.key))}>Valider les propositions fiables ({reliableCount})</button>
                  <button type="button" className="btn-ghost" disabled={busy || !picked} onClick={() => setDecisions((key) => key === axis.key ? false : null)}>Ignorer ce critère</button>
                </div>
                {items.map(({ result, estimate }) => <LocalEstimateRow key={result.productId} title={result.productName ?? result.productId}
                  axis={axis} estimate={estimate} current={result.currentValues[axis.key]} invalid={false} disabled={busy} decision={featDecisions[result.productId]?.[axis.key]}
                  onChange={(patch) => setFeatDecisions((previous) => ({ ...previous, [result.productId]: { ...previous[result.productId], [axis.key]: { ...previous[result.productId][axis.key], ...patch } } }))} />)}
              </details>;
            })}
            <div className="xw-actionbar" data-testid="feat-actionbar">
              <span className="xe-muted">{featUpdates.length ? `${chosen} valeur(s) validée(s) sur ${summarizeUpdates(featUpdates).products} produit(s) — pas encore enregistré` : "Aucune proposition validée"}</span>
              <button type="button" className="btn-primary" disabled={busy || !featUpdates.length} data-testid="feat-save" onClick={() => void saveFeatures()}>
                {busy ? "Enregistrement…" : "Enregistrer les caractéristiques"}</button>
            </div>
          </>}
        </>;
      })()}
      {featSaved && <p className="section-hint" role="status">✓ {featSaved}</p>}
      {featError && <p className="form-error" role="alert">{featError} <button type="button" className="table-link" onClick={() => void loadFeatures()}>Relancer l'analyse</button></p>}
      {nav("criteria", () => setStep("questions"), "Continuer →", true, true)}
    </section>}

    {step === "questions" && draft && <section className="xw-card">
      <h2 className="section-title">4. Questions et réponses</h2>
      <label className="xw-radio"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /><span>Mode avancé : afficher les identifiants et les valeurs chiffrées</span></label>
      {draft.questions.map((question, qi) => <fieldset key={qi} className="xw-card">
        <legend className="field-label">Question {qi + 1}</legend>
        {question.info && <p className="xe-muted" data-testid={`question-info-${qi}`}>
          Critère : <strong>{question.info.criterion}</strong> · {KIND_LABELS[question.info.kind]}
          {question.info.strict && <> · <span className="badge badge-featured">Plafond strict</span></>}
          {question.info.needsValidation && <> · <span className="badge badge-inactive">À valider</span> {question.info.validationReason}</>}
          {question.info.coverageNote && <><br />⚠ {question.info.coverageNote}</>}
        </p>}
        {question.helpText && <p className="xe-muted">{question.helpText}</p>}
        {question.info && !question.answers.some((a) => !Object.keys(a.impacts).length && !!a.effects?.effects.length && a.effects.effects.every((e) => e.type === "none")) &&
          <p className="import-warn" role="status" data-testid={`question-no-neutral-${qi}`}>⚠ Cette question n'a plus de réponse « Sans préférence » : un visiteur sans avis devra choisir une option qui oriente sa recommandation. Vous pouvez la rétablir avec « Remplacer par une suggestion » ou relancer l'analyse.</p>}
        <input className="field-input" aria-label={`Texte de la question ${qi + 1}`} value={question.text} maxLength={300} onChange={(e) => edit(updateQuestion(draft, qi, { text: e.target.value }))} />
        {question.answers.map((answer, ai) => <div key={ai} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="field-input" aria-label={`Réponse ${ai + 1} de la question ${qi + 1}`} value={answer.text} maxLength={150}
              onChange={(e) => edit(updateAnswer(draft, qi, ai, { text: e.target.value }))} style={{ flex: "1 1 220px" }} />
            <button type="button" className="btn-ghost" disabled={question.answers.length <= 2} onClick={() => edit(removeAnswer(draft, qi, ai))}>Retirer</button>
          </div>
          <span className="xe-muted">
            {answer.effectSummary ?? (Object.entries(answer.impacts).map(([key, value]) => `${value > 0 ? "▲" : "▼"} ${axisLabel.get(key) ?? key}`).join(" · ") || "Aucun effet sur les critères")}
          </span>
          {advanced && !answer.effects?.effects.some((e) => e.type === "category" || e.type === "range") && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{draft.axes.map((axis) => <label key={axis.key} className="xe-muted">
            {axis.key}{" "}<input type="number" step="0.05" min={-1} max={1} style={{ width: 72 }} aria-label={`Impact sur ${axis.label}`}
              value={answer.impacts[axis.key] ?? 0} onChange={(e) => edit(setImpact(draft, qi, ai, axis.key, Number(e.target.value)))} />
          </label>)}</div>}
        </div>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" disabled={question.answers.length >= 4 || (!!question.info && question.info.kind !== "axis")} onClick={() => edit(addAnswer(draft, qi))}>+ Ajouter une réponse</button>
          <button type="button" className="btn-ghost" onClick={() => {
            const suggestions = proposal?.alternatives ?? [];
            const used = new Set(draft.questions.map((q) => q.text));
            for (const suggestion of suggestions.filter((s) => !used.has(s.text))) {
              const next = replaceQuestion(draft, qi, suggestion);
              if (next) { edit(next); setNotice(""); return; }
            }
            setNotice("Aucune autre suggestion compatible avec vos critères.");
          }}>Remplacer par une suggestion</button>
          <button type="button" className="btn-ghost" disabled={draft.questions.length <= 1} onClick={() => {
            const questions = draft.questions.filter((_, i) => i !== qi);
            edit({ ...draft, questions });
          }}>Supprimer la question</button>
        </div>
      </fieldset>)}
      {proposal && proposal.alternatives.some((q) => q.info?.needsValidation) && <div className="xw-card" data-testid="express-suggestions">
        <h3 className="field-label">Autres questions possibles, à valider</h3>
        <p className="section-hint">POAPO ne sait pas si ces caractéristiques comptent vraiment pour vos visiteurs. Ajoutez-les seulement si c'est le cas.</p>
        {proposal.alternatives.filter((q) => q.info?.needsValidation && !draft.questions.some((used) => used.text === q.text)).map((suggestion) => <div key={suggestion.text} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ flex: "1 1 260px" }}><strong>{suggestion.text}</strong><br /><span className="xe-muted">{suggestion.info!.criterion} — {suggestion.info!.validationReason}</span></span>
          <button type="button" className="btn-ghost" disabled={draft.questions.length >= 10} onClick={() => edit({ ...draft, questions: [...draft.questions, suggestion] })}>Ajouter au quiz</button>
        </div>)}
      </div>}
      {nav("features", () => void goPreview(), "Prévisualiser →")}
    </section>}

    {step === "preview" && draft && <section className="xw-card">
      <h2 className="section-title">5. Prévisualisation</h2>
      <p className="section-hint">Répondez comme un visiteur : la recommandation est calculée par le vrai moteur de POAPO sur vos produits.</p>
      {draft.questions.map((question, qi) => <fieldset key={qi} className="xw-card">
        <legend className="field-label">{question.text}</legend>
        {question.answers.map((answer, ai) => <label key={ai} className="xw-radio">
          <input type="radio" name={`preview-${qi}`} checked={picks[qi] === ai} onChange={() => { setPicks(picks.map((p, i) => i === qi ? ai : p)); setPreview(null); }} />
          <span>{answer.emoji} {answer.text}</span>
        </label>)}
      </fieldset>)}
      {ready !== "ready" && <p className="section-hint" role="status">⏳ {readinessText(readiness)} Vous pouvez enregistrer le brouillon dès maintenant et tester plus tard.</p>}
      <button type="button" className="btn-primary" disabled={busy || ready !== "ready"} onClick={() => void recommend()}>{busy ? "Calcul…" : "Voir les recommandations"}</button>
      {preview && <div role="status">
        {preview.reliability !== "reliable" && <p className="section-hint">⚠ Ces recommandations sont indicatives : les données du catalogue ne séparent pas bien vos produits.</p>}
        <ol>{preview.recommendations.map((item) => <li key={item.product.id}><strong>{item.product.name}</strong>{item.product.brand ? ` — ${item.product.brand}` : ""} <span className="xe-muted">(score {Math.round(item.score * 100)} %)</span></li>)}</ol>
      </div>}
      {nav("questions", () => setStep("save"), "Enregistrer →", false)}
    </section>}

    {step === "save" && draft && <section className="xw-card">
      <h2 className="section-title">6. Enregistrer en brouillon</h2>
      <div className="field-group">
        <label className="field-label" htmlFor="express-name">Nom de l'expérience</label>
        <input id="express-name" className="field-input" value={draft.name} maxLength={120} onChange={(e) => edit({ ...draft, name: e.target.value })} />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="express-title">Titre affiché aux visiteurs</label>
        <input id="express-title" className="field-input" value={draft.quizTitle} maxLength={120} onChange={(e) => edit({ ...draft, quizTitle: e.target.value })} />
      </div>
      <p className="section-hint">{draft.questions.length} question(s) construite(s) sur {draft.axes.length + draft.questions.filter((q) => q.info && q.info.kind !== "axis").length} critère(s). L'expérience est créée inactive : rien n'est visible de vos visiteurs. Vous passez ensuite à la publication, où POAPO vérifie que tout est prêt ; si une vérification bloque, elle vous dit pourquoi et vous propose le bon correctif. Vous pouvez aussi reprendre plus tard depuis « Mes quiz ».</p>
      {ready !== "ready" && <p className="section-hint" role="status">{readinessText(readiness)}</p>}
      {reliability !== "reliable" && <label className="xw-radio"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
        <span>Je comprends que les données du catalogue ne permettent pas des recommandations pleinement fiables.</span></label>}
      <div className="xw-footer">
        <button type="button" className="btn-ghost" onClick={() => setStep("preview")}>← Retour</button>
        <button type="button" className="btn-primary" disabled={busy || (reliability !== "reliable" && !acknowledge)} onClick={() => void save(leaveAfterSave)}>{busy ? "Enregistrement…" : leaveAfterSave ? "Enregistrer et reprendre plus tard" : "Enregistrer le brouillon"}</button>
      </div>
    </section>}
  </div>;
}
