import { useState } from "react";
import type { QuizEditorDraftResponse, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { ApiError, apiFetch } from "../lib/api";
import type { QuizEditorSession } from "../hooks/useQuizEditorDraft";

export default function QuizPublicationPanel({ editor, quizId, visible, pending, navigate, locate, onLocate, onPublished, onBusyChange }: {
  editor: QuizEditorSession; quizId: string; visible: boolean; pending: boolean;
  navigate?: (section: "questions" | "appearance", questionId?: string) => void;
  /** Éditeur unifié : localise un diagnostic dans n'importe quelle section sans quitter la page. */
  locate?: (issue: QuizPublicationIssue) => unknown;
  onLocate?: (issue: QuizPublicationIssue) => void;
  onPublished: (result: QuizEditorDraftResponse, diagnostic: QuizPublicationDiagnostic) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [diagnostic, setDiagnostic] = useState<QuizPublicationDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sharedConfirmed, setSharedConfirmed] = useState(false);
  const revision = editor.state?.revision;
  const stale = diagnostic?.revision !== revision;
  const local = editor.dirty || pending;
  const disabled = busy || editor.loading || editor.saving || !editor.state || local || editor.conflict;
  async function check() {
    onBusyChange(true);
    setBusy(true); setError(""); setSuccess(""); setConfirmed(false); setSharedConfirmed(false);
    try {
      setDiagnostic(await apiFetch<QuizPublicationDiagnostic>(`/api/quizzes/${encodeURIComponent(quizId)}/publication/check`, {
        method: "POST", body: JSON.stringify({ revision }),
      }));
    } catch (err) {
      setDiagnostic(null);
      setError(err instanceof Error ? err.message : "Impossible de vérifier le quiz");
      if (err instanceof ApiError && err.status === 409) editor.fail(err);
    } finally { setBusy(false); onBusyChange(false); }
  }
  async function publish() {
    if (!diagnostic || disabled || stale || !confirmed || (diagnostic.campaigns.length > 1 && !sharedConfirmed)) return;
    setBusy(true); setError(""); setSuccess("");
    onBusyChange(true);
    try {
      const result = await apiFetch<QuizEditorDraftResponse>(`/api/quizzes/${encodeURIComponent(quizId)}/publication/publish`, {
        method: "POST", body: JSON.stringify({
          revision, confirm: true,
          ...(diagnostic.campaigns.length > 1 && { confirmedCampaignIds: diagnostic.campaigns.map((c) => c.id) }),
        }),
      });
      editor.accept(result);
      onPublished(result, diagnostic);
      setDiagnostic(null); setConfirmed(false); setSharedConfirmed(false);
      setSuccess("Quiz publié avec succès. La version publique a été mise à jour ; le brouillon a été réinitialisé.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "La publication a échoué");
      setDiagnostic(null);
      if (err instanceof ApiError && err.status === 409) editor.fail(err);
    } finally { setBusy(false); onBusyChange(false); }
  }
  function issues(items: QuizPublicationIssue[]) {
    return <ul>{items.map((issue, index) => <li key={`${issue.code}:${index}`}>
      <span>{issue.message}</span>{" "}
      {locate && onLocate ? (locate(issue) ? <button type="button" className="table-link" onClick={() => onLocate(issue)}>Corriger</button> : null)
        : issue.section === "configuration" ? <a href={`/quizzes/${encodeURIComponent(quizId)}`}>Configurer le quiz</a>
        : issue.section !== "publication" && <button type="button" className="table-link"
          onClick={() => navigate?.(issue.section === "appearance" ? "appearance" : "questions", issue.questionId)}>Voir l'élément</button>}
    </li>)}</ul>;
  }
  return <section id="editor-panel-publication" role="tabpanel" aria-labelledby="editor-tab-publication"
    hidden={!visible} className="quiz-editor-panel quiz-publication">
    <h2>Vérification et publication</h2>
    <p>Seule la révision enregistrée du brouillon sera publiée. La vérification est relancée côté serveur au moment de publier.</p>
    <p>La publication applique aussi l'état actif/inactif et la sélection de catalogue du brouillon.
      Elle ne change aucun statut ni calendrier de campagne.</p>
    <p><strong>{editor.state?.hasChanges ? "Modifications préparatoires enregistrées" : "Aucun brouillon enregistré à publier"}</strong>
      {revision !== undefined && ` — révision ${revision}`}</p>
    {local && <p role="status" className="quiz-editor-shared">Terminez les formulaires et enregistrez vos modifications locales avant de vérifier ou publier.</p>}
    <button type="button" className="btn-primary" disabled={disabled} onClick={() => void check()}>
      {busy ? "Opération en cours…" : "Vérifier le quiz"}
    </button>
    {error && <p className="form-error" role="alert">{error} Aucun succès de publication n'a été confirmé. Relancez la vérification.</p>}
    {success && <p className="quiz-preview-notice" role="status">{success}</p>}
    {diagnostic && !stale && <>
      <dl className="quiz-editor-context">
        <div><dt>Quiz</dt><dd>{diagnostic.summary.name}</dd></div>
        <div><dt>Catalogue</dt><dd>{diagnostic.summary.catalogName}</dd></div>
        <div><dt>Questions actives / produits actifs</dt><dd>{diagnostic.summary.questions} / {diagnostic.summary.products}</dd></div>
        <div><dt>État après publication</dt><dd>{diagnostic.summary.active ? "Actif" : "Inactif"}</dd></div>
      </dl>
      <h3>Erreurs bloquantes ({diagnostic.errors.length})</h3>
      {diagnostic.errors.length ? issues(diagnostic.errors) : <p>Aucune erreur bloquante.</p>}
      <h3>Avertissements ({diagnostic.warnings.length})</h3>
      {diagnostic.warnings.length ? issues(diagnostic.warnings) : <p>Aucun avertissement.</p>}
      <h3>Campagnes associées</h3>
      {diagnostic.campaigns.length ? <ul>{diagnostic.campaigns.map((c) => <li key={c.id}>
        <a href={`/campaigns/${encodeURIComponent(c.id)}`}>{c.name}</a>
      </li>)}</ul> : <p>Aucune campagne associée.</p>}
      {diagnostic.valid && diagnostic.hasChanges && <fieldset disabled={disabled} className="publication-confirmation">
        <legend>Confirmation de publication</legend>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Je confirme le remplacement de la version publique par cette révision enregistrée.</label>
        {diagnostic.campaigns.length > 1 && <label className="quiz-editor-shared">
          <input type="checkbox" checked={sharedConfirmed} onChange={(event) => setSharedConfirmed(event.target.checked)} />
          Je confirme que toutes les campagnes listées ci-dessus partageront cette nouvelle version du quiz.
        </label>}
        <button type="button" className="btn-primary"
          disabled={!confirmed || (diagnostic.campaigns.length > 1 && !sharedConfirmed)}
          onClick={() => void publish()}>Publier le brouillon</button>
      </fieldset>}
    </>}
  </section>;
}
