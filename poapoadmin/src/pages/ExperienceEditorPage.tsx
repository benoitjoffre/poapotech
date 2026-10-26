import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Campaign, CampaignListResponse, Quiz, QuizBranding, QuizEditorDraft, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useCatalogs } from "../lib/catalogs";
import { publicQuizLink } from "../lib/experienceLinks";
import { useQuizEditorDraft } from "../hooks/useQuizEditorDraft";
import { QuizBuilderContent } from "./QuizBuilderPage";
import QuizAppearancePanel from "../components/QuizAppearancePanel";
import QuizInteractivePreview from "../components/QuizInteractivePreview";
import QuizPublicationPanel from "../components/QuizPublicationPanel";
import ExperienceCampaignsPanel from "../components/quizEditor/ExperienceCampaignsPanel";
import ExperienceProductsSummary from "../components/quizEditor/ExperienceProductsSummary";
import {
  QuizAxesFields, QuizGeneralFields, QuizProductSelection, EMPTY_CONFIG, toDraftConfig, useCatalogProducts,
  type QuizConfigForm,
} from "../components/quizEditor/QuizConfigFields";
import { recommendableProducts } from "../components/quizEditor/ExperienceProductsSummary";
import { issueTarget } from "../lib/publicationIssues";
import { publicAvailability } from "../lib/experiences";
import { experienceEditorPath, experienceSetupPath } from "../lib/experienceLinks";
import { parseStep, resumeStep, stepComplete, WIZARD_STEPS, type WizardProgress } from "../lib/experienceWizard";
import { WizardActivation, WizardFooter, WizardPreferencesIntro, WizardProductsIntro, WizardPublished, WizardStepper } from "../components/quizEditor/ExperienceWizardParts";
import "../components/quizEditor/experienceEditor.css";
import "../components/quizEditor/experienceWizard.css";
import "../components/experiences/experiences.css";

const SECTIONS = [
  { id: "configuration", label: "Configuration" },
  { id: "products", label: "Produits" },
  { id: "questions", label: "Questions" },
  { id: "appearance", label: "Apparence" },
  { id: "preview", label: "Aperçu" },
  { id: "publication", label: "Publication" },
] as const;
type Section = typeof SECTIONS[number]["id"];
const isSection = (value: string | null): value is Section => SECTIONS.some((item) => item.id === value);

interface EditorContext { quiz: Quiz; campaigns: Campaign[]; branding: QuizBranding & { active?: boolean } }

type Config = QuizEditorDraft["config"];
function sameConfig(a: Config, b: Config): boolean {
  const axes = (config: Config) => config.axes.map((axis) => [axis.key, axis.label, axis.lowLabel ?? "", axis.highLabel ?? ""].join("\u0000"));
  return a.name === b.name && a.catalogId === b.catalogId && a.industry === b.industry && a.quizTitle === b.quizTitle &&
    a.ctaText === b.ctaText && a.active === b.active && a.useAllProducts === b.useAllProducts &&
    JSON.stringify(a.productIds) === JSON.stringify(b.productIds) && JSON.stringify(axes(a)) === JSON.stringify(axes(b));
}

function validateConfig(form: QuizConfigForm): string {
  if (!form.catalogId) return "Choisissez un catalogue.";
  if (!form.name.trim() || !form.quizTitle.trim() || !form.ctaText.trim()) return "Le nom, le titre public et le texte du bouton sont obligatoires.";
  const keys = new Set<string>();
  for (const axis of form.axes) {
    if (!axis.label.trim()) return "Chaque préférence de recommandation doit avoir un libellé.";
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(axis.key)) return `La clé technique « ${axis.key} » est invalide (lettres, chiffres et _, commence par une lettre).`;
    if (keys.has(axis.key)) return `La clé technique « ${axis.key} » est utilisée deux fois.`;
    keys.add(axis.key);
  }
  return "";
}

export default function ExperienceEditorPage() {
  const { quizId = "" } = useParams();
  return <ExperienceEditorLoader key={quizId} quizId={quizId} />;
}

/** Assistant de création : même éditeur, même session de brouillon, présenté en cinq étapes. */
export function ExperienceSetupPage() {
  const { quizId = "" } = useParams();
  return <ExperienceEditorLoader key={`setup:${quizId}`} quizId={quizId} wizard />;
}

// Sections du mode éditeur affichées pour chaque étape de l'assistant.
const STEP_SECTIONS: Record<number, readonly Section[]> = {
  1: ["products"], 2: ["configuration"], 3: ["questions"], 4: ["appearance", "preview"], 5: ["publication"],
};
function stepForTarget(target: Section, elementId?: string): number {
  if (target === "products") return 1;
  if (target === "configuration") return elementId && /^(axis-|quiz-add-axis)/.test(elementId) ? 2 : 1;
  if (target === "questions") return 3;
  if (target === "appearance" || target === "preview") return 4;
  return 5;
}

function ExperienceEditorLoader({ quizId, wizard = false }: { quizId: string; wizard?: boolean }) {
  const [context, setContext] = useState<EditorContext | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    async function load() {
      const id = encodeURIComponent(quizId);
      // Toutes les lectures sont limitées au tenant authentifié par l'API.
      const [quiz, related, branding] = await Promise.all([
        apiFetch<Quiz>(`/api/quizzes/${id}`),
        apiFetch<CampaignListResponse>(`/api/campaigns?quizId=${id}`),
        apiFetch<QuizBranding & { active?: boolean }>("/api/auth/me"),
      ]);
      if (!cancelled) setContext({ quiz, campaigns: related.data, branding });
    }
    void load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger l'éditeur");
    });
    return () => { cancelled = true; };
  }, [quizId, attempt]);

  if (!context) return <div className="page campaign-quiz-editor experience-editor">
    <Link className="table-link" to="/quizzes">← Mes expériences</Link>
    {error ? <>
      <div className="form-error" role="alert">{error}</div>
      <button type="button" className="btn-ghost" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
    </> : <div className="loading-block" role="status">Chargement de l'éditeur…</div>}
  </div>;

  return <ExperienceEditor initial={context} wizard={wizard} />;
}

function ExperienceEditor({ initial, wizard = false }: { initial: EditorContext; wizard?: boolean }) {
  const { campaigns, branding } = initial;
  const [quiz, setQuiz] = useState(initial.quiz);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("section");
  const [section, setSection] = useState<Section>(isSection(requested) ? requested : "configuration");
  const editor = useQuizEditorDraft(quiz.id);
  const { catalogs, loading: catalogsLoading } = useCatalogs();
  const [form, setForm] = useState<QuizConfigForm>(EMPTY_CONFIG);
  const [formError, setFormError] = useState("");
  const [applied, setApplied] = useState(false);
  const [builderPending, setBuilderPending] = useState(false);
  const navigate = useNavigate();
  const [step, setStepState] = useState<number | null>(null);
  const [maxReached, setMaxReached] = useState(1);
  const [wizardError, setWizardError] = useState("");
  const [wizardBusy, setWizardBusy] = useState(false);
  const [published, setPublished] = useState<QuizPublicationDiagnostic["summary"] | null>(null);
  const setStep = useCallback((next: number) => {
    setStepState(next);
    setMaxReached((current) => Math.max(current, next));
    setWizardError("");
  }, []);
  const { products, loading: productsLoading, error: productsError, loadedFor } = useCatalogProducts(form.catalogId);

  // Le formulaire local repart du brouillon serveur à chaque chargement, sauvegarde, import ou abandon.
  useEffect(() => {
    if (editor.state) { setForm(editor.state.draft.config); setFormError(""); setApplied(false); }
  }, [editor.state]);

  const config = editor.draft?.config;
  const availability = publicAvailability({ shopActive: branding.active !== false, quizActive: quiz.active });
  const formDirty = !!config && !sameConfig(toDraftConfig(form), config);
  const onBuilderPending = useCallback((value: boolean) => setBuilderPending(value), []);
  const catalogName = catalogs.find((item) => item.id === form.catalogId)?.name ?? quiz.catalog?.name ?? "—";

  const changeCatalog = (catalogId: string) => {
    if (catalogId === form.catalogId) return;
    if (form.productIds.length > 0 && !window.confirm("Changer de catalogue retire les produits sélectionnés pour ce quiz. Continuer ?")) return;
    setForm({ ...form, catalogId, productIds: [] });
  };
  const applyForm = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateConfig(form);
    setFormError(problem);
    if (problem || !editor.draft) return;
    editor.setDraft((current) => current ? { ...current, config: toDraftConfig(form) } : current);
    setApplied(true);
  };

  const state = useMemo(() => {
    if (editor.conflict) return { id: "conflict", label: "Conflit de révision", hint: "Rechargez le brouillon serveur pour continuer." };
    if (editor.saving) return { id: "saving", label: "Sauvegarde en cours…", hint: "" };
    if (formDirty || builderPending) return { id: "local", label: "Modification locale non appliquée", hint: "Appliquez ou annulez le formulaire ouvert." };
    if (editor.dirty) return { id: "applied", label: "Appliquée, non enregistrée", hint: "Enregistrez le brouillon pour la conserver." };
    if (editor.state?.hasChanges) return { id: "saved", label: `Brouillon enregistré · révision ${editor.state.revision}`, hint: "Non publié : le quiz public est inchangé." };
    return { id: "published", label: "Aucun brouillon", hint: "Le quiz public correspond à la version publiée." };
  }, [editor.conflict, editor.saving, editor.dirty, editor.state, formDirty, builderPending]);

  const questionCount = editor.draft?.questions.length;
  const progress: WizardProgress = {
    catalogId: config?.catalogId ?? "",
    recommendableProducts: config && !productsLoading ? recommendableProducts(config, products).length : null,
    axisCount: config?.axes.length ?? 0,
    playableQuestions: editor.draft?.questions.filter((q) => q.active && q.answers.some((a) => a.active)).length ?? 0,
  };
  const productsReady = !!config && !productsLoading && (!config.catalogId || loadedFor === config.catalogId);
  const requestedStep = parseStep(searchParams.get("step"));
  // L'étape initiale n'est fixée qu'une fois le brouillon et les produits chargés : reprise sur la première étape incomplète.
  useEffect(() => {
    if (!wizard || step !== null || !editor.state || !productsReady) return;
    const resume = resumeStep(progress);
    setStepState(requestedStep ?? resume);
    setMaxReached(Math.max(requestedStep ?? 1, resume));
  }, [wizard, step, editor.state, productsReady, progress, requestedStep]);
  const show = (id: Section) => wizard ? !!step && STEP_SECTIONS[step].includes(id) : section === id;

  const goTo = (target: Section, questionId?: string) => focusTarget(target, questionId ? `editor-question-${questionId}` : undefined);
  const focusTarget = (target: Section, elementId?: string) => {
    if (wizard) setStep(stepForTarget(target, elementId));
    setSection(target);
    // Les panneaux restent montés : les modifications locales survivent au changement de section.
    let attempts = 0;
    const reach = () => {
      const element = elementId ? document.getElementById(elementId) : null;
      const visible = element && element.getClientRects().length > 0;
      if (visible) { element.scrollIntoView({ block: "center" }); element.focus({ preventScroll: true }); return; }
      if (attempts++ < 10) { requestAnimationFrame(reach); return; }
      document.getElementById(`editor-tab-${target}`)?.focus();
    };
    requestAnimationFrame(reach);
  };
  const locateIssue = (issue: QuizPublicationIssue) => issueTarget(issue, form);

  // Applique le formulaire local puis enregistre le brouillon ; rien d'invalide n'est enregistré.
  const commit = async (): Promise<boolean> => {
    setWizardError("");
    if (builderPending) { setWizardError("Terminez ou annulez le formulaire de question ouvert avant de continuer."); return false; }
    if (!editor.draft) return false;
    let next = editor.draft;
    if (formDirty) {
      const problem = validateConfig(form);
      setFormError(problem);
      if (problem) { setWizardError(problem); return false; }
      next = { ...editor.draft, config: toDraftConfig(form) };
      editor.setDraft(next);
      setApplied(true);
    }
    if (!formDirty && !editor.dirty) return true;
    setWizardBusy(true);
    try {
      const saved = await editor.save(next);
      if (!saved) setWizardError("Le brouillon n'a pas pu être enregistré. Vos modifications locales sont conservées.");
      return saved;
    } finally { setWizardBusy(false); }
  };
  const goStep = async (target: number) => {
    if (step === null || target === step) return;
    // Revenir en arrière ne force pas d'enregistrement : les formulaires restent montés et conservent leurs modifications.
    if (target < step) { setStep(target); return; }
    if (await commit()) setStep(target);
  };
  const [quitting, setQuitting] = useState(false);
  const saveAndQuit = async () => { if (await commit()) setQuitting(true); };
  // La navigation attend que la garde de sortie voie l'état enregistré.
  const clean = !formDirty && !editor.dirty && !builderPending;
  useEffect(() => { if (quitting && clean) navigate("/quizzes"); }, [quitting, clean, navigate]);
  const stepComplete5 = WIZARD_STEPS.map((item) => stepComplete(item.id, progress));

  if (wizard && step === null) return <div className="page campaign-quiz-editor experience-editor">
    <Link className="table-link" to="/quizzes">← Mes expériences</Link>
    <div className="loading-block" role="status">{editor.error ? editor.error : "Préparation de l'assistant…"}</div>
  </div>;

  return <div className={`page campaign-quiz-editor experience-editor${wizard ? " xw-wizard" : ""}`}>
    <header className="quiz-editor-header xe-header">
      <nav className="quiz-editor-breadcrumb" aria-label="Fil d'Ariane">
        <Link to={`/quizzes?experience=${encodeURIComponent(quiz.id)}`}>← Mes expériences</Link>
      </nav>
      {wizard && <p className="xe-muted xw-eyebrow">Assistant de création · étape {step} sur {WIZARD_STEPS.length}</p>}
      <div className="xe-title-row">
        <div>
          <h1 className="page-title">{config?.name ?? quiz.name}</h1>
          <p className="section-hint">Titre public : {config?.quizTitle ?? quiz.quizTitle}</p>
        </div>
        <div className="xe-actions">
          <Link className="btn-ghost" to={`/analytics?quizId=${encodeURIComponent(quiz.id)}`}>Voir les résultats</Link>
          {availability.accessible
            ? <a className="btn-ghost" href={publicQuizLink(quiz.tenantId, quiz.id)} target="_blank" rel="noreferrer">Lien public (version publiée)</a>
            : <span className="xe-muted" id="xe-no-link">Lien public indisponible : {availability.reason?.toLowerCase()}</span>}
          {wizard
            ? <Link className="btn-ghost" to={experienceEditorPath(quiz.id)}>Éditeur complet</Link>
            : <>
              <Link className="btn-ghost" to={experienceSetupPath(quiz.id)}>Assistant guidé</Link>
              {section !== "publication" && <button type="button" className="btn-primary" onClick={() => goTo("publication")}>Aller à la publication</button>}
            </>}
        </div>
      </div>
      <ul className="xp-badges xe-chips" aria-label="Résumé de l'expérience">
        <li className={`xp-badge ${availability.accessible ? "public" : "inactive"}`}>Public : {availability.accessible ? "accessible" : `désactivé (${availability.reason?.toLowerCase()})`}</li>
        {config && config.active !== quiz.active && <li className="xp-badge draft">Activation préparée : effective à la publication</li>}
        <li className={`xp-badge xe-state ${state.id}`} data-state={state.id} role="status">{state.label}</li>
        <li className="xp-badge">Catalogue : {catalogName}</li>
        {questionCount !== undefined && <li className="xp-badge">{questionCount} question{questionCount > 1 ? "s" : ""}</li>}
        <li className="xp-badge">{campaigns.length === 0 ? "Aucune campagne" : `${campaigns.length} campagne${campaigns.length > 1 ? "s" : ""}`}</li>
      </ul>
      {state.hint && <p className="section-hint xe-hint">{state.hint}</p>}
    </header>

    <div className="xe-layout">
      <div className="xe-main">
        {wizard && step !== null && <WizardStepper step={step} maxReached={maxReached} complete={stepComplete5} onSelect={(target) => void goStep(target)} />}
        {!wizard && <div className="quiz-editor-tabs" role="tablist" aria-label="Sections de l'éditeur d'expérience">
          {SECTIONS.map((item, index) => <button key={item.id} type="button" role="tab"
            id={`editor-tab-${item.id}`} aria-selected={section === item.id} aria-controls={`editor-panel-${item.id}`}
            tabIndex={section === item.id ? 0 : -1} className={`quiz-editor-tab${section === item.id ? " active" : ""}`}
            onClick={() => setSection(item.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % SECTIONS.length;
              else if (event.key === "ArrowLeft") next = (index + SECTIONS.length - 1) % SECTIONS.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = SECTIONS.length - 1;
              else return;
              event.preventDefault();
              setSection(SECTIONS[next].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>
            <span className="quiz-editor-step" aria-hidden="true">{index + 1}</span>
            <span>{item.label}</span>
          </button>)}
        </div>}

        <QuizBuilderContent quiz={quiz} embedded session={editor} visible={show("questions")}
          externalPending={formDirty} onPendingChange={onBuilderPending}
          renderAppearance={(session, disabled, themeError) => <QuizAppearancePanel editor={session} branding={branding}
            disabled={disabled} error={themeError} visible={show("appearance")} />}
          renderPreview={(session, pending) => <QuizInteractivePreview editor={session} quizId={quiz.id}
            visible={show("preview")} pending={pending} />}
          renderPublication={(session, pending, onBusyChange) => <QuizPublicationPanel editor={session} quizId={quiz.id}
            pending={pending} onBusyChange={onBusyChange} visible={show("publication")} navigate={goTo}
            locate={locateIssue} onLocate={(issue) => { const target = locateIssue(issue); if (target) focusTarget(target.section, target.elementId); }}
            onPublished={(result, diagnostic) => {
              setPublished(diagnostic.summary);
              setQuiz((current) => ({
                ...current, ...result.draft.config,
                catalog: { ...current.catalog, id: diagnostic.summary.catalogId, name: diagnostic.summary.catalogName },
              }));
            }} />} />

        <div hidden={!show("configuration")} className="quiz-editor-panel" role="tabpanel"
          id="editor-panel-configuration" aria-labelledby="editor-tab-configuration">
          <form className="product-form" onSubmit={applyForm} noValidate>
            <fieldset disabled={!editor.draft || editor.saving} className="xe-fieldset">
              <h2 className="page-title">Configuration</h2>
              <p className="section-hint">Ces réglages sont préparés dans le brouillon. « Appliquer » les transmet à l'éditeur ; « Enregistrer le brouillon » les conserve sur le serveur. Le quiz public reste inchangé jusqu'à la publication.</p>
              {!wizard && <QuizGeneralFields form={form} setForm={setForm} catalogs={catalogs} catalogsLoading={catalogsLoading}
                onCatalogChange={changeCatalog} canActivate isDefault={quiz.isDefault} />}
              {wizard && <WizardPreferencesIntro form={form} setForm={setForm} />}
              <QuizAxesFields form={form} setForm={setForm} title="Préférences de recommandation"
                publishedAxes={quiz.axes ?? []} onError={setFormError} />
              <ApplyBar error={formError} dirty={formDirty} applied={applied} />
            </fieldset>
          </form>
        </div>

        <div hidden={!show("products")} className="quiz-editor-panel" role="tabpanel"
          id="editor-panel-products" aria-labelledby="editor-tab-products">
          <form className="product-form" onSubmit={applyForm} noValidate>
            <fieldset disabled={!editor.draft || editor.saving} className="xe-fieldset">
              <h2 className="page-title">Produits</h2>
              {wizard && <>
                <WizardProductsIntro productCount={progress.recommendableProducts ?? 0} loading={productsLoading} catalogId={form.catalogId} />
                <QuizGeneralFields form={form} setForm={setForm} catalogs={catalogs} catalogsLoading={catalogsLoading}
                  onCatalogChange={changeCatalog} canActivate isDefault={quiz.isDefault} showActivation={false} />
              </>}
              <ExperienceProductsSummary form={form} catalogName={catalogName} catalogId={form.catalogId}
                products={products} loading={productsLoading} error={productsError} />
              <QuizProductSelection form={form} setForm={setForm} catalogName={catalogName} products={products} loading={productsLoading} />
              <ApplyBar error={formError} dirty={formDirty} applied={applied} />
            </fieldset>
          </form>
        </div>
        {wizard && step === 5 && <section className="xw-card">
          <WizardActivation form={form} setForm={setForm} disabled={!editor.draft || editor.saving} />
          {(formDirty || editor.dirty) && <button type="button" className="btn-primary" disabled={wizardBusy || editor.saving} onClick={() => void commit()}>Appliquer et enregistrer</button>}
          <p className="section-hint">L'activation est préparée dans le brouillon et ne devient effective qu'à la publication de la révision enregistrée.</p>
          <WizardPublished tenantId={quiz.tenantId} quizId={quiz.id} availability={availability} published={published} />
        </section>}
        {wizard && step !== null && <WizardFooter step={step} busy={wizardBusy || editor.saving}
          canContinue={step < WIZARD_STEPS.length} continueLabel="Enregistrer et continuer" error={wizardError}
          onBack={() => void goStep(step - 1)} onContinue={() => void goStep(step + 1)} onSaveQuit={() => void saveAndQuit()} />}
      </div>

      <div className="xe-side">
        <ExperienceCampaignsPanel campaigns={campaigns} quizName={quiz.name} />
      </div>
    </div>
  </div>;
}

function ApplyBar({ error, dirty, applied }: { error: string; dirty: boolean; applied: boolean }) {
  return <div className="xe-apply">
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="btn-primary" disabled={!dirty}>Appliquer au brouillon en cours</button>
    <span className="xe-muted" role="status">{dirty ? "Modifications locales non appliquées." : applied ? "Appliqué. Pensez à enregistrer le brouillon." : "Aucune modification locale."}</span>
  </div>;
}
