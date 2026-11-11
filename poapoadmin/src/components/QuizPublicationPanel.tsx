import { useState } from "react";
import type { QuizEditorDraftResponse, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { ApiError, apiFetch } from "../lib/api";
import type { QuizEditorSession } from "../hooks/useQuizEditorDraft";

export default function QuizPublicationPanel({ editor, quizId, visible, pending, navigate, locate, onLocate, onPublished, onBusyChange, primaryAction }: {
  editor: QuizEditorSession; quizId: string; visible: boolean; pending: boolean;
  navigate?: (section: "questions" | "appearance", questionId?: string) => void;
  /** Éditeur unifié : localise un diagnostic dans n'importe quelle section sans quitter la page. */
  locate?: (issue: QuizPublicationIssue) => unknown;
  onLocate?: (issue: QuizPublicationIssue) => void;
  onPublished: (result: QuizEditorDraftResponse, diagnostic: QuizPublicationDiagnostic) => void;
  onBusyChange: (busy: boolean) => void;
  /** Action principale « Publier et rendre accessible » : prépare l'activation dans le brouillon, l'enregistre, puis réutilise la vérification et la publication ci-dessous. */
  primaryAction?: { label: string; prepare: () => Promise<QuizEditorDraftResponse | null> };
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
  async function runCheck(rev: number | undefined): Promise<QuizPublicationDiagnostic | null> {
    try {
      const result = await apiFetch<QuizPublicationDiagnostic>(`/api/quizzes/${encodeURIComponent(quizId)}/publication/check`, {
        method: "POST", body: JSON.stringify({ revision: rev }),
      });
      setDiagnostic(result);
      return result;
    } catch (err) {
      setDiagnostic(null);
      setError(err instanceof Error ? err.message : "Impossible de vérifier l'expérience");
      if (err instanceof ApiError && err.status === 409) editor.fail(err);
      return null;
    }
  }
  async function runPublish(rev: number | undefined, checked: QuizPublicationDiagnostic): Promise<boolean> {
    try {
      const result = await apiFetch<QuizEditorDraftResponse>(`/api/quizzes/${encodeURIComponent(quizId)}/publication/publish`, {
        method: "POST", body: JSON.stringify({
          revision: rev, confirm: true,
          ...(checked.campaigns.length > 1 && { confirmedCampaignIds: checked.campaigns.map((c) => c.id) }),
        }),
      });
      editor.accept(result);
      onPublished(result, checked);
      setDiagnostic(null); setConfirmed(false); setSharedConfirmed(false);
      setSuccess("Expérience publiée : vos visiteurs voient maintenant cette version.");
      return true;
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "La publication a échoué"} Vos modifications restent enregistrées dans le brouillon : vous pouvez réessayer.`);
      setDiagnostic(null);
      if (err instanceof ApiError && err.status === 409) editor.fail(err);
      return false;
    }
  }
  async function check() {
    onBusyChange(true);
    setBusy(true); setError(""); setSuccess(""); setConfirmed(false); setSharedConfirmed(false);
    await runCheck(revision);
    setBusy(false); onBusyChange(false);
  }
  async function publish() {
    if (!diagnostic || disabled || stale || !confirmed || (diagnostic.campaigns.length > 1 && !sharedConfirmed)) return;
    setBusy(true); setError(""); setSuccess("");
    onBusyChange(true);
    await runPublish(revision, diagnostic);
    setBusy(false); onBusyChange(false);
  }
  // Enregistre l'activation dans le brouillon, vérifie, puis publie. Avec plusieurs campagnes
  // partageant le quiz, on s'arrête sur la confirmation explicite existante.
  async function publishAndActivate() {
    if (!primaryAction || busy || editor.loading || editor.saving || editor.conflict || pending) return;
    onBusyChange(true);
    setBusy(true); setError(""); setSuccess(""); setConfirmed(false); setSharedConfirmed(false); setDiagnostic(null);
    try {
      const saved = await primaryAction.prepare();
      if (!saved) { setError("Le brouillon n'a pas pu être enregistré."); return; }
      const checked = await runCheck(saved.revision);
      if (!checked || !checked.valid || !checked.hasChanges || checked.campaigns.length > 1) {
        if (checked && checked.campaigns.length > 1 && checked.valid) setConfirmed(true);
        return;
      }
      await runPublish(saved.revision, checked);
    } finally { setBusy(false); onBusyChange(false); }
  }
  function issues(items: QuizPublicationIssue[]) {
    return <ul>{items.map((issue, index) => <li key={`${issue.code}:${index}`}>
      <span>{issue.message}</span>{" "}
      {locate && onLocate ? (locate(issue) ? <button type="button" className="table-link" onClick={() => onLocate(issue)}>Corriger</button> : null)
        : issue.section === "configuration" ? <a href={`/experiences/${encodeURIComponent(quizId)}/edit?section=configuration`}>Corriger dans les réglages</a>
        : issue.section !== "publication" && <button type="button" className="table-link"
          onClick={() => navigate?.(issue.section === "appearance" ? "appearance" : "questions", issue.questionId)}>Voir</button>}
    </li>)}</ul>;
  }
  return <section id="editor-panel-publication" role="tabpanel" aria-labelledby="editor-tab-publication"
    hidden={!visible} className="quiz-editor-panel quiz-publication">
    <h2>Publier mon expérience</h2>
    <p>Vérifiez que tout est prêt, puis publiez : vos visiteurs verront la dernière version enregistrée.</p>
    <p><strong>{editor.state?.hasChanges ? "Modifications enregistrées, prêtes à publier" : "Rien de nouveau à publier"}</strong>
      </p>
    {primaryAction && <div className="publication-primary">
      <button type="button" id="publish-and-activate" className="btn-primary" disabled={busy || editor.loading || editor.saving || !editor.state || editor.conflict || pending} onClick={() => void publishAndActivate()}>
        {busy ? "Publication en cours…" : primaryAction.label}
      </button>
      <p className="section-hint">Enregistre, vérifie, publie et rend accessible votre expérience en une seule étape.</p>
    </div>}
    {local && <p role="status" className="quiz-editor-shared">Vos dernières modifications s'enregistrent automatiquement : patientez un instant avant de publier.</p>}
    <button type="button" className="btn-primary" disabled={disabled} onClick={() => void check()}>
      {busy ? "Opération en cours…" : "Vérifier avant de publier"}
    </button>
    {error && <p className="form-error" role="alert">{error} La publication n'a pas eu lieu. Réessayez.</p>}
    {success && <p className="quiz-preview-notice" role="status">{success}</p>}
    {diagnostic && !stale && <>
      <dl className="quiz-editor-context">
        <div><dt>Expérience</dt><dd>{diagnostic.summary.name}</dd></div>
        <div><dt>Catalogue</dt><dd>{diagnostic.summary.catalogName}</dd></div>
        <div><dt>Questions / produits proposés</dt><dd>{diagnostic.summary.questions} / {diagnostic.summary.products}</dd></div>
        <div><dt>Visible par vos visiteurs après publication</dt><dd>{diagnostic.summary.active ? "Oui" : "Non"}</dd></div>
      </dl>
      <h3>À corriger avant de publier ({diagnostic.errors.length})</h3>
      {diagnostic.errors.length ? issues(diagnostic.errors) : <p>Rien à corriger.</p>}
      <h3>Conseils ({diagnostic.warnings.length})</h3>
      {diagnostic.warnings.length ? issues(diagnostic.warnings) : <p>Aucun conseil.</p>}
      <h3>Campagnes associées</h3>
      {diagnostic.campaigns.length ? <ul>{diagnostic.campaigns.map((c) => <li key={c.id}>
        <a href={`/campaigns/${encodeURIComponent(c.id)}`}>{c.name}</a>
      </li>)}</ul> : <p>Aucune campagne associée.</p>}
      {diagnostic.valid && diagnostic.hasChanges && <fieldset disabled={disabled} className="publication-confirmation">
        <legend>Confirmer la publication</legend>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Je confirme : mes visiteurs verront cette nouvelle version.</label>
        {diagnostic.campaigns.length > 1 && <label className="quiz-editor-shared">
          <input type="checkbox" checked={sharedConfirmed} onChange={(event) => setSharedConfirmed(event.target.checked)} />
          Je confirme que toutes les campagnes listées partageront cette nouvelle version.
        </label>}
        <button type="button" className="btn-primary"
          disabled={!confirmed || (diagnostic.campaigns.length > 1 && !sharedConfirmed)}
          onClick={() => void publish()}>Publier</button>
      </fieldset>}
    </>}
  </section>;
}
