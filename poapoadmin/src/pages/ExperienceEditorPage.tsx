import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ExperiencesOverview, Quiz, QuizBranding, QuizEditorDraft, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useCatalogs } from "../lib/catalogs";
import { publicQuizLink } from "../lib/experienceLinks";
import { useQuizEditorDraft } from "../hooks/useQuizEditorDraft";
import { QuizBuilderContent } from "./QuizBuilderPage";
import QuizAppearancePanel from "../components/QuizAppearancePanel";
import QuizInteractivePreview from "../components/QuizInteractivePreview";
import QuizPublicationPanel from "../components/QuizPublicationPanel";
import QuizPeriodFields from "../components/quizEditor/QuizPeriodFields";
import ExperienceProductsSummary from "../components/quizEditor/ExperienceProductsSummary";
import {
  QuizAxesFields, QuizGeneralFields, QuizProductSelection, EMPTY_CONFIG, toDraftConfig, useCatalogProducts,
  type QuizConfigForm,
} from "../components/quizEditor/QuizConfigFields";
import { issueTarget } from "../lib/publicationIssues";
import { publicAvailability } from "../lib/experiences";
import { canPublishAndActivate, publicationStatus, type ServerPublicationState } from "../lib/publicationStatus";
import { WizardPublished, WizardPublicationStatus } from "../components/quizEditor/ExperienceWizardParts";
import "../components/quizEditor/experienceEditor.css";
import "../components/quizEditor/experienceWizard.css";
import "../components/experiences/experiences.css";

const SECTIONS = [
  { id: "configuration", label: "Réglages" },
  { id: "questions", label: "Questions" },
  { id: "appearance", label: "Apparence" },
  { id: "preview", label: "Aperçu" },
  { id: "publication", label: "Publication" },
] as const;
type Section = typeof SECTIONS[number]["id"] | "products";
const isSection = (value: string | null): value is Section => value === "products" || SECTIONS.some((item) => item.id === value);
// Les produits recommandables sont dans l'onglet Réglages.
const tabOf = (value: Section): Exclude<Section, "products"> => value === "products" ? "configuration" : value;

interface EditorContext { quiz: Quiz; branding: QuizBranding & { active?: boolean } }

type Config = QuizEditorDraft["config"];
function sameConfig(a: Config, b: Config): boolean {
  const axes = (config: Config) => config.axes.map((axis) => [axis.key, axis.label, axis.lowLabel ?? "", axis.highLabel ?? ""].join("\u0000"));
  return a.name === b.name && a.catalogId === b.catalogId && a.industry === b.industry && a.quizTitle === b.quizTitle &&
    a.ctaText === b.ctaText && a.active === b.active && a.useAllProducts === b.useAllProducts &&
    JSON.stringify(a.productIds) === JSON.stringify(b.productIds) && JSON.stringify(axes(a)) === JSON.stringify(axes(b));
}

function validateConfig(form: QuizConfigForm): string {
  if (!form.catalogId) return "Choisissez un catalogue.";
  if (!form.name.trim() || !form.quizTitle.trim() || !form.ctaText.trim()) return "Le nom, le titre affiché aux visiteurs et le texte du bouton sont obligatoires.";
  const keys = new Set<string>();
  for (const axis of form.axes) {
    if (!axis.label.trim()) return "Chaque critère doit avoir un nom.";
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

function ExperienceEditorLoader({ quizId }: { quizId: string }) {
  const [context, setContext] = useState<EditorContext | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    async function load() {
      const id = encodeURIComponent(quizId);
      // Toutes les lectures sont limitées au tenant authentifié par l'API.
      const [quiz, branding] = await Promise.all([
        apiFetch<Quiz>(`/api/quizzes/${id}`),
        apiFetch<QuizBranding & { active?: boolean }>("/api/auth/me"),
      ]);
      if (!cancelled) setContext({ quiz, branding });
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

  return <ExperienceEditor initial={context} />;
}

function ExperienceEditor({ initial }: { initial: EditorContext }) {
  const { branding } = initial;
  const [quiz, setQuiz] = useState(initial.quiz);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("section");
  const [section, setSection] = useState<Exclude<Section, "products">>(isSection(requested) ? tabOf(requested) : "configuration");
  const editor = useQuizEditorDraft(quiz.id);
  const { catalogs, loading: catalogsLoading } = useCatalogs();
  const [form, setForm] = useState<QuizConfigForm>(EMPTY_CONFIG);
  const [formError, setFormError] = useState("");
  const [applied, setApplied] = useState(false);
  const [builderPending, setBuilderPending] = useState(false);
  const appliedRef = useRef<Config | null>(null);
  const [published, setPublished] = useState<QuizPublicationDiagnostic["summary"] | null>(null);
  // État public réel renvoyé par l'API (jamais déduit de l'interface seule) ; rechargé après chaque publication.
  const [server, setServer] = useState<ServerPublicationState | null>(null);
  const [serverError, setServerError] = useState("");
  const refreshServer = useCallback(async () => {
    try {
      const overview = await apiFetch<ExperiencesOverview>("/api/experiences");
      const item = overview.experiences.find((entry) => entry.id === quiz.id);
      if (!item) throw new Error("Expérience introuvable");
      setServer({ shopActive: overview.shopActive, accessible: item.accessible, questionCount: item.questionCount, hasDraft: item.hasDraft });
      setServerError("");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Impossible de lire l'état de publication");
    }
  }, [quiz.id]);
  useEffect(() => { void refreshServer(); }, [refreshServer]);
  const { products, loading: productsLoading, error: productsError } = useCatalogProducts(form.catalogId);

  // Le formulaire local repart du brouillon serveur à chaque chargement, sauvegarde, import ou abandon.
  useEffect(() => {
    if (!editor.state) return;
    // Écho de notre propre enregistrement automatique : on garde ce que l'utilisateur a pu taper depuis.
    if (appliedRef.current && sameConfig(editor.state.draft.config, appliedRef.current)) { appliedRef.current = null; setApplied(false); return; }
    setForm(editor.state.draft.config); setFormError(""); setApplied(false);
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

  // Réglages : validés puis enregistrés automatiquement après une courte pause (rien d'invalide n'est enregistré).
  useEffect(() => {
    if (!formDirty || !editor.draft) return;
    const timer = window.setTimeout(() => {
      const problem = validateConfig(form);
      setFormError(problem);
      if (problem) return;
      const next = toDraftConfig(form);
      appliedRef.current = next;
      editor.setDraft((current) => current ? { ...current, config: next } : current);
      setApplied(true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  const localChanges = formDirty || builderPending || editor.dirty;
  const status = server ? publicationStatus({ ...server, hasDraft: server.hasDraft || !!editor.state?.hasChanges }, localChanges) : null;

  // « Publier et rendre accessible » : l'activation est portée par le brouillon, enregistrée ici,
  // puis appliquée atomiquement par la publication existante (jamais par le simple enregistrement).
  const prepareActivation = async () => {
    if (!editor.draft) return null;
    const problem = validateConfig(form);
    setFormError(problem);
    if (problem) return null;
    const next = { ...editor.draft, config: { ...toDraftConfig(form), active: true } };
    editor.setDraft(next);
    setForm({ ...form, active: true });
    return editor.persist(next);
  };

  const state = useMemo(() => {
    if (editor.conflict) return { id: "conflict", label: "Conflit de modifications", hint: "Cette expérience a été modifiée ailleurs. Rechargez pour continuer." };
    if (editor.saving) return { id: "saving", label: "Enregistrement…", hint: "" };
    if (formDirty || builderPending) return { id: "local", label: "Modifications en cours", hint: "Enregistrement automatique dès que vous faites une pause." };
    if (editor.dirty) return { id: "applied", label: "Enregistrement en cours…", hint: "" };
    if (editor.state?.hasChanges) return { id: "saved", label: "Modifications enregistrées automatiquement", hint: "Pas encore publié : vos visiteurs voient toujours l'ancienne version." };
    return { id: "published", label: "Tout est à jour", hint: "Vos visiteurs voient la dernière version." };
  }, [editor.conflict, editor.saving, editor.dirty, editor.state, formDirty, builderPending]);

  const questionCount = editor.draft?.questions.length;
  const show = (id: Section) => section === tabOf(id);

  const goTo = (target: Section, questionId?: string) => focusTarget(target, questionId ? `editor-question-${questionId}` : undefined);
  const focusTarget = (target: Section, elementId?: string) => {
    setSection(tabOf(target));
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

  return <div className="page campaign-quiz-editor experience-editor">
    <header className="quiz-editor-header xe-header">
      <nav className="quiz-editor-breadcrumb" aria-label="Fil d'Ariane">
        <Link to={`/quizzes?experience=${encodeURIComponent(quiz.id)}`}>← Mes expériences</Link>
      </nav>
      <div className="xe-title-row">
        <div>
          <h1 className="page-title">{config?.name ?? quiz.name}</h1>
          <p className="section-hint">Titre affiché aux visiteurs : {config?.quizTitle ?? quiz.quizTitle}</p>
        </div>
        <div className="xe-actions">
          <Link className="btn-ghost" to={`/analytics?quizId=${encodeURIComponent(quiz.id)}`}>Voir les résultats</Link>
          {availability.accessible
            ? <a className="btn-ghost" href={publicQuizLink(quiz.tenantId, quiz.id)} target="_blank" rel="noreferrer">Lien public (version publiée)</a>
            : <span className="xe-muted" id="xe-no-link">Lien public indisponible : {availability.reason?.toLowerCase()}</span>}
          {section !== "publication" && <button type="button" className="btn-primary" onClick={() => goTo("publication")}>Aller à la publication</button>}
        </div>
      </div>
      <ul className="xp-badges xe-chips" aria-label="Résumé de l'expérience">
        <li className={`xp-badge ${availability.accessible ? "public" : "inactive"}`}>Public : {availability.accessible ? "accessible" : `désactivé (${availability.reason?.toLowerCase()})`}</li>
        {status && <li className={`xp-badge xe-publication ${status.id}`} data-publication={status.id}>{status.label}</li>}
        {config && config.active !== quiz.active && <li className="xp-badge draft">Activation préparée : effective à la publication</li>}
        <li className={`xp-badge xe-state ${state.id}`} data-state={state.id} role="status">{state.label}</li>
        <li className="xp-badge">Catalogue : {catalogName}</li>
        {questionCount !== undefined && <li className="xp-badge">{questionCount} question{questionCount > 1 ? "s" : ""}</li>}
      </ul>
      {state.hint && <p className="section-hint xe-hint">{state.hint}</p>}
    </header>

    <div className="xe-layout">
      <div className="xe-main">
        <div className="quiz-editor-tabs" role="tablist" aria-label="Sections de l'éditeur d'expérience">
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
        </div>

        <QuizBuilderContent quiz={quiz} embedded session={editor} visible={show("questions")}
          externalPending={formDirty} onPendingChange={onBuilderPending}
          renderAppearance={(session, disabled, themeError) => <QuizAppearancePanel editor={session} branding={branding}
            disabled={disabled} error={themeError} visible={show("appearance")} />}
          renderPreview={(session, pending) => <QuizInteractivePreview editor={session} quizId={quiz.id}
            visible={show("preview")} pending={pending} />}
          renderPublication={(session, pending, onBusyChange) => <QuizPublicationPanel editor={session} quizId={quiz.id}
            pending={pending} onBusyChange={onBusyChange} visible={show("publication")} navigate={goTo}
            primaryAction={status && canPublishAndActivate(status, server?.shopActive ?? true)
              ? { label: "Publier et rendre accessible", prepare: prepareActivation } : undefined}
            locate={locateIssue} onLocate={(issue) => { const target = locateIssue(issue); if (target) focusTarget(target.section, target.elementId); }}
            onPublished={(result, diagnostic) => {
              setPublished(diagnostic.summary);
              void refreshServer();
              setQuiz((current) => ({
                ...current, ...result.draft.config,
                catalog: { ...current.catalog, id: diagnostic.summary.catalogId, name: diagnostic.summary.catalogName },
              }));
            }} />} />

        <div hidden={!show("configuration")} className="quiz-editor-panel" role="tabpanel"
          id="editor-panel-configuration" aria-labelledby="editor-tab-configuration">
          <form className="product-form" onSubmit={applyForm} noValidate>
            <fieldset disabled={!editor.draft || editor.saving} className="xe-fieldset">
              <h2 className="page-title">Réglages</h2>
              <p className="section-hint">Nom, titre et bouton affichés à vos visiteurs, critères de choix et produits proposés. Rien n'est visible par vos visiteurs avant la publication.</p>
              <QuizGeneralFields form={form} setForm={setForm} catalogs={catalogs} catalogsLoading={catalogsLoading}
                onCatalogChange={changeCatalog} canActivate isDefault={quiz.isDefault} />
              <QuizAxesFields form={form} setForm={setForm} title="Critères de choix"
                publishedAxes={quiz.axes ?? []} onError={setFormError} />
              <ExperienceProductsSummary form={form} catalogName={catalogName} catalogId={form.catalogId}
                products={products} loading={productsLoading} error={productsError} />
              <QuizProductSelection form={form} setForm={setForm} catalogName={catalogName} products={products} loading={productsLoading} />
              <ApplyBar error={formError} dirty={formDirty} applied={applied} />
            </fieldset>
          </form>
          <QuizPeriodFields quiz={quiz} />
        </div>

        {section === "publication" && <section className="xw-card">
          <WizardPublicationStatus status={status} error={serverError} onRetry={() => void refreshServer()} />
          {status && (status.id === "live" || status.id === "disabled") && !localChanges &&
            <WizardPublished tenantId={quiz.tenantId} quizId={quiz.id} availability={server ? { accessible: server.accessible, label: status?.label ?? "", reason: status?.reason ?? null } : availability} published={published} />}
        </section>}
      </div>

    </div>
  </div>;
}

function ApplyBar({ error }: { error: string; dirty: boolean; applied: boolean }) {
  return error ? <div className="xe-apply"><p className="form-error" role="alert">{error}</p></div> : null;
}
