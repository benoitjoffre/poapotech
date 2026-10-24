import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Campaign, CampaignListResponse, Quiz, QuizBranding } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { QuizBuilderContent } from "./QuizBuilderPage";
import Icon from "../components/Icon";
import QuizAppearancePanel from "../components/QuizAppearancePanel";
import QuizInteractivePreview from "../components/QuizInteractivePreview";
import QuizPublicationPanel from "../components/QuizPublicationPanel";

const SECTIONS = [
  { id: "questions", label: "Questions", description: "" },
  { id: "appearance", label: "Apparence", description: "" },
  { id: "preview", label: "Aperçu", description: "" },
  { id: "publication", label: "Publication", description: "" },
] as const;

type Section = typeof SECTIONS[number]["id"];
interface EditorContext {
  campaign: Campaign;
  quiz: Quiz;
  campaigns: Campaign[];
  branding: QuizBranding;
}

export default function CampaignQuizEditorPage() {
  const { campaignId = "" } = useParams();
  return <CampaignQuizEditor key={campaignId} campaignId={campaignId} />;
}

function CampaignQuizEditor({ campaignId }: { campaignId: string }) {
  const [context, setContext] = useState<EditorContext | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<Section>("questions");

  useEffect(() => {
    let cancelled = false;
    setError("");
    async function load() {
      const campaign = await apiFetch<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
      // The authenticated campaign, not a query-string quiz selection, determines the edited quiz.
      const quizId = encodeURIComponent(campaign.quizId);
      const [quiz, related, branding] = await Promise.all([
        apiFetch<Quiz>(`/api/quizzes/${quizId}`),
        apiFetch<CampaignListResponse>(`/api/campaigns?quizId=${quizId}`),
        apiFetch<QuizBranding>("/api/auth/me"),
      ]);
      if (!cancelled) setContext({ campaign, quiz, campaigns: related.data, branding });
    }
    void load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger l'éditeur de campagne");
    });
    return () => { cancelled = true; };
  }, [campaignId, attempt]);

  if (!context) return <div className="page">
    <Link className="table-link" to="/campaigns">← Campagnes</Link>
    {error ? <>
      <div className="form-error" role="alert">{error}</div>
      <button type="button" className="btn-ghost" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
    </> : <div className="loading-block" role="status">Chargement de l'éditeur…</div>}
  </div>;

  const { campaign, quiz, campaigns, branding } = context;
  const shared = campaigns.filter((item) => item.id !== campaign.id);

  return <div className="page campaign-quiz-editor">
    <header className="quiz-editor-header">
      <nav className="quiz-editor-breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/campaigns">Campagnes</Link><span aria-hidden="true">/</span>
        <Link to={`/campaigns/${encodeURIComponent(campaign.id)}`}>{campaign.name}</Link>
        <span aria-hidden="true">/</span><span aria-current="page">Personnaliser le quiz</span>
      </nav>
      <p className="quiz-editor-eyebrow">Éditeur de campagne</p>
      <h1 className="page-title">{campaign.name}</h1>
      <dl className="quiz-editor-context">
        <div><dt>Quiz associé</dt><dd>{quiz.name}</dd></div>
        <div><dt>Catalogue associé</dt><dd>{campaign.quiz.catalog.name}</dd></div>
      </dl>
      <p className="section-hint">Travaillez sur le brouillon du quiz. Les modifications restent privées jusqu'à votre confirmation de publication.</p>
    </header>

    {shared.length > 0 && <aside className="quiz-editor-shared" aria-labelledby="shared-quiz-title">
      <h2 id="shared-quiz-title"><Icon name="users" size={18} />Quiz partagé entre {shared.length + 1} campagnes</h2>
      <p>Ce quiz et son brouillon sont communs à ces campagnes. Vos modifications ne sont pas propres à « {campaign.name} ».
        Une future publication du quiz concernera toutes les campagnes qui l'utilisent. Aucun quiz n'est dupliqué.</p>
      <ul>{shared.map((item) => <li key={item.id}>
        <Link to={`/campaigns/${encodeURIComponent(item.id)}`}>{item.name}</Link>
      </li>)}</ul>
    </aside>}

    <div className="quiz-editor-tabs" role="tablist" aria-label="Sections de personnalisation du quiz">
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

    <QuizBuilderContent quiz={quiz} embedded visible={section === "questions"}
      renderAppearance={(editor, disabled, themeError) => <QuizAppearancePanel editor={editor} branding={branding}
        disabled={disabled} error={themeError} visible={section === "appearance"} />}
      renderPreview={(editor, pending) => <QuizInteractivePreview editor={editor} quizId={quiz.id}
        visible={section === "preview"} pending={pending} />}
      renderPublication={(editor, pending, onBusyChange) => <QuizPublicationPanel editor={editor} quizId={quiz.id} pending={pending} onBusyChange={onBusyChange}
        visible={section === "publication"} navigate={(target, questionId) => {
          setSection(target);
          requestAnimationFrame(() => {
            document.getElementById(questionId ? `editor-question-${questionId}` : `editor-tab-${target}`)?.scrollIntoView({ block: "center" });
          });
        }} onPublished={(result, diagnostic) => setContext((current) => current ? {
          ...current, quiz: { ...current.quiz, ...result.draft.config },
          campaign: { ...current.campaign, quiz: { ...current.campaign.quiz,
            name: result.draft.config.name, active: result.draft.config.active,
            catalog: { id: diagnostic.summary.catalogId, name: diagnostic.summary.catalogName } } },
        } : current)} />} />
  </div>;
}
