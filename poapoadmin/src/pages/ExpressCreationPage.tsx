import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  ExpressDraft, ExpressPreviewResponse, ExpressProposal, ExpressQuestionCount, ExpressSaveResponse, ExpressSector, ExpressValidation,
} from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useCatalogs } from "../lib/catalogs";
import { experienceEditorPath } from "../lib/experienceLinks";
import {
  addAnswer, removeAnswer, removeAxis, renameAxis, replaceQuestion, setImpact, updateAnswer, updateQuestion,
} from "../lib/expressDraft";
import "../components/quizEditor/experienceEditor.css";
import "../components/quizEditor/experienceWizard.css";

type Step = "setup" | "criteria" | "questions" | "preview" | "save";
const STEPS: { id: Step; label: string }[] = [
  { id: "setup", label: "Catalogue" }, { id: "criteria", label: "Critères" }, { id: "questions", label: "Questions" },
  { id: "preview", label: "Aperçu" }, { id: "save", label: "Brouillon" },
];
const SECTORS: { id: ExpressSector; label: string }[] = [
  { id: "coffee", label: "Café" }, { id: "perfume", label: "Parfum" }, { id: "travel", label: "Voyage" }, { id: "fashion", label: "Mode" },
];
const RELIABILITY = {
  reliable: { badge: "badge badge-active", label: "Données suffisantes" },
  limited: { badge: "badge badge-featured", label: "Recommandations approximatives" },
  insufficient: { badge: "badge badge-inactive", label: "Recommandations non fiables" },
} as const;

/** Création express : analyse du catalogue, brouillon déterministe modifiable, aperçu réel, enregistrement en brouillon inactif. */
export default function ExpressCreationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templateMode = params.get("mode") === "template";
  const { catalogs, loading, error: catalogsError } = useCatalogs();
  const [chosen, setChosen] = useState(params.get("catalogId") ?? "");
  const [sector, setSector] = useState<ExpressSector | "">(templateMode ? "coffee" : "");
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

  const catalogId = catalogs.length === 1 ? catalogs[0].id : catalogs.some((item) => item.id === chosen) ? chosen : "";
  const axisLabel = useMemo(() => new Map((draft?.axes ?? []).map((axis) => [axis.key, axis.label])), [draft]);
  const reliability = validation?.reliability ?? proposal?.analysis.reliability ?? "insufficient";

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try { return await task(); } catch (err) { setError(err instanceof Error ? err.message : "L'opération a échoué"); return null; } finally { setBusy(false); }
  }

  async function analyse(exclude: string[] = excluded) {
    if (!catalogId) { setError("Choisissez un catalogue."); return; }
    const result = await run(() => apiFetch<ExpressProposal>("/api/express-quiz/analyze", {
      method: "POST",
      body: JSON.stringify({ catalogId, ...(sector && { sector }), ...(questionCount && { questionCount }), ...(exclude.length && { exclude }) }),
    }));
    if (!result) return;
    setProposal(result);
    setDraft(result.draft);
    setExcluded(exclude);
    setPicks(result.draft ? result.draft.questions.map(() => 0) : []);
    setValidation(null);
    setPreview(null);
    setNotice("");
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
    const result = await run(() => apiFetch<ExpressValidation>("/api/express-quiz/validate", { method: "POST", body: JSON.stringify({ catalogId, draft }) }));
    if (result) setValidation(result);
    return result;
  }

  async function goPreview() {
    if (await validate()) setStep("preview");
  }

  async function recommend() {
    const result = await run(() => apiFetch<ExpressPreviewResponse>("/api/express-quiz/preview", { method: "POST", body: JSON.stringify({ catalogId, draft, answers: picks }) }));
    if (result) setPreview(result);
  }

  async function save() {
    const result = await run(() => apiFetch<ExpressSaveResponse>("/api/express-quiz/save", {
      method: "POST", body: JSON.stringify({ catalogId, draft, acknowledgeLimits: acknowledge }),
    }));
    if (result) navigate(experienceEditorPath(result.quizId), { replace: true });
  }

  const nav = (prev: Step | null, next: (() => void) | null, nextLabel = "Continuer →") => <div className="xw-footer">
    {prev ? <button type="button" className="btn-ghost" onClick={() => setStep(prev)}>← Retour</button> : <Link className="btn-ghost" to="/experiences/new">Quitter</Link>}
    {next && <button type="button" className="btn-primary" disabled={busy} onClick={next}>{busy ? "Patientez…" : nextLabel}</button>}
  </div>;

  return <div className="page experience-editor xw-create">
    <Link className="table-link" to="/experiences/new">← Autres façons de créer</Link>
    <h1 className="page-title">{templateMode ? "Partir d'un modèle" : "Création express"}</h1>
    <ol className="xw-steps" aria-label="Étapes">{STEPS.map((item) => <li key={item.id} aria-current={item.id === step ? "step" : undefined}
      style={{ fontWeight: item.id === step ? 700 : 400 }}>{item.label}</li>)}</ol>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="section-hint" role="status">{notice}</p>}

    {step === "setup" && <section className="xw-card">
      <h2 className="section-title">1. Votre catalogue</h2>
      {loading && <div className="loading-block" role="status">Chargement de vos catalogues…</div>}
      {catalogsError && <p className="form-error" role="alert">{catalogsError}</p>}
      {catalogs.length === 1 && <p>Catalogue « {catalogs[0].name} » ({catalogs[0].activeProductCount} produit(s) actif(s)), sélectionné automatiquement.</p>}
      {catalogs.length > 1 && catalogs.map((catalog) => <label key={catalog.id} className="xw-radio">
        <input type="radio" name="catalog" checked={catalogId === catalog.id} onChange={() => setChosen(catalog.id)} />
        <span><strong>{catalog.name}</strong><br /><span className="xe-muted">{catalog.activeProductCount} produit(s) actif(s)</span></span>
      </label>)}
      {templateMode && <div className="field-group">
        <label className="field-label" htmlFor="express-sector">Modèle</label>
        <select id="express-sector" className="field-input" value={sector} onChange={(e) => setSector(e.target.value as ExpressSector)}>
          {SECTORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value="generic">Aucun (uniquement mes données)</option>
        </select>
        <p className="field-hint">Le modèle propose des critères et des questions types ; seuls ceux qui correspondent à vos produits sont considérés comme fiables.</p>
      </div>}
      <div className="field-group">
        <label className="field-label" htmlFor="express-count">Nombre de questions</label>
        <select id="express-count" className="field-input" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value) as ExpressQuestionCount | 0)}>
          <option value={0}>Automatique</option><option value={3}>3 — rapide</option><option value={5}>5 — équilibré</option><option value={7}>7 — précis</option>
        </select>
      </div>
      <p className="section-hint">POAPO lit vos produits et prépare un brouillon modifiable. Rien n'est publié et aucun produit n'est modifié.</p>
      <div className="xw-footer">
        <Link className="btn-ghost" to="/experiences/new">Quitter</Link>
        <button type="button" className="btn-primary" disabled={busy || !catalogId} onClick={() => void analyse([])}>{busy ? "Analyse…" : "Analyser mon catalogue →"}</button>
      </div>
    </section>}

    {step !== "setup" && proposal && <section className="xw-card" aria-label="Analyse du catalogue">
      <p><span className={RELIABILITY[reliability].badge}>{RELIABILITY[reliability].label}</span>{" "}
        <span className="xe-muted">{proposal.analysis.productCount} produit(s) · secteur {proposal.analysis.sectorDetected ? "détecté" : "choisi"} : {proposal.analysis.sectorLabel}</span></p>
      {[...proposal.analysis.messages, ...(validation?.warnings ?? [])].map((message, i) => <p key={i} className="section-hint">⚠ {message}</p>)}
      {reliability !== "reliable" && <p className="section-hint">Pour fiabiliser : renseignez les caractéristiques de vos produits dans <Link to="/enrichment">Enrichissement</Link>.</p>}
    </section>}

    {step === "criteria" && proposal && <section className="xw-card">
      <h2 className="section-title">2. Critères de recommandation</h2>
      {!draft && <p>Aucune proposition honnête n'est possible avec ces données. <Link to="/enrichment">Enrichissez vos produits</Link>, choisissez <Link to="/experiences/new/express?mode=template">un modèle</Link> ou utilisez la <Link to="/experiences/new?mode=manual">création manuelle</Link>.</p>}
      {draft && <>
        <p className="section-hint">Ce sont les caractéristiques qui comparent vos produits aux réponses des visiteurs.</p>
        {draft.axes.map((axis) => <div key={axis.key} className="xw-radio" style={{ flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
            <input className="field-input" aria-label={`Nom du critère ${axis.label}`} value={axis.label} maxLength={60}
              onChange={(e) => edit(renameAxis(draft, axis.key, e.target.value))} style={{ flex: "1 1 180px" }} />
            <button type="button" className="btn-ghost" disabled={draft.axes.length <= 1} onClick={() => dropCriterion(axis.key)}>Supprimer</button>
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
      {nav("setup", draft ? () => setStep("questions") : null)}
    </section>}

    {step === "questions" && draft && <section className="xw-card">
      <h2 className="section-title">3. Questions et réponses</h2>
      <label className="xw-radio"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /><span>Mode avancé : afficher les identifiants et les impacts chiffrés</span></label>
      {draft.questions.map((question, qi) => <fieldset key={qi} className="xw-card">
        <legend className="field-label">Question {qi + 1}</legend>
        <input className="field-input" aria-label={`Texte de la question ${qi + 1}`} value={question.text} maxLength={300} onChange={(e) => edit(updateQuestion(draft, qi, { text: e.target.value }))} />
        {question.answers.map((answer, ai) => <div key={ai} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="field-input" aria-label={`Réponse ${ai + 1} de la question ${qi + 1}`} value={answer.text} maxLength={150}
              onChange={(e) => edit(updateAnswer(draft, qi, ai, { text: e.target.value }))} style={{ flex: "1 1 220px" }} />
            <button type="button" className="btn-ghost" disabled={question.answers.length <= 2} onClick={() => edit(removeAnswer(draft, qi, ai))}>Retirer</button>
          </div>
          <span className="xe-muted">
            {Object.entries(answer.impacts).map(([key, value]) => `${value > 0 ? "▲" : "▼"} ${axisLabel.get(key) ?? key}`).join(" · ") || "Aucun effet sur les critères"}
          </span>
          {advanced && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{draft.axes.map((axis) => <label key={axis.key} className="xe-muted">
            {axis.key}{" "}<input type="number" step="0.05" min={-1} max={1} style={{ width: 72 }} aria-label={`Impact sur ${axis.label}`}
              value={answer.impacts[axis.key] ?? 0} onChange={(e) => edit(setImpact(draft, qi, ai, axis.key, Number(e.target.value)))} />
          </label>)}</div>}
        </div>)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" disabled={question.answers.length >= 4} onClick={() => edit(addAnswer(draft, qi))}>+ Ajouter une réponse</button>
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
      {nav("criteria", () => void goPreview(), "Prévisualiser →")}
    </section>}

    {step === "preview" && draft && <section className="xw-card">
      <h2 className="section-title">4. Prévisualisation</h2>
      <p className="section-hint">Répondez comme un visiteur : la recommandation est calculée par le vrai moteur de POAPO sur vos produits.</p>
      {draft.questions.map((question, qi) => <fieldset key={qi} className="xw-card">
        <legend className="field-label">{question.text}</legend>
        {question.answers.map((answer, ai) => <label key={ai} className="xw-radio">
          <input type="radio" name={`preview-${qi}`} checked={picks[qi] === ai} onChange={() => { setPicks(picks.map((p, i) => i === qi ? ai : p)); setPreview(null); }} />
          <span>{answer.emoji} {answer.text}</span>
        </label>)}
      </fieldset>)}
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void recommend()}>{busy ? "Calcul…" : "Voir les recommandations"}</button>
      {preview && <div role="status">
        {preview.reliability !== "reliable" && <p className="section-hint">⚠ Ces recommandations sont indicatives : les données du catalogue ne séparent pas bien vos produits.</p>}
        <ol>{preview.recommendations.map((item) => <li key={item.product.id}><strong>{item.product.name}</strong>{item.product.brand ? ` — ${item.product.brand}` : ""} <span className="xe-muted">(score {Math.round(item.score * 100)} %)</span></li>)}</ol>
      </div>}
      {nav("questions", () => setStep("save"), "Enregistrer →")}
    </section>}

    {step === "save" && draft && <section className="xw-card">
      <h2 className="section-title">5. Enregistrer en brouillon</h2>
      <div className="field-group">
        <label className="field-label" htmlFor="express-name">Nom de l'expérience</label>
        <input id="express-name" className="field-input" value={draft.name} maxLength={120} onChange={(e) => edit({ ...draft, name: e.target.value })} />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="express-title">Titre public</label>
        <input id="express-title" className="field-input" value={draft.quizTitle} maxLength={120} onChange={(e) => edit({ ...draft, quizTitle: e.target.value })} />
      </div>
      <p className="section-hint">{draft.axes.length} critère(s), {draft.questions.length} question(s). L'expérience est créée inactive : vous la relirez, la testerez et la publierez vous-même.</p>
      {reliability !== "reliable" && <label className="xw-radio"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
        <span>Je comprends que les données du catalogue ne permettent pas des recommandations pleinement fiables.</span></label>}
      <div className="xw-footer">
        <button type="button" className="btn-ghost" onClick={() => setStep("preview")}>← Retour</button>
        <button type="button" className="btn-primary" disabled={busy || (reliability !== "reliable" && !acknowledge)} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
      </div>
    </section>}
  </div>;
}
