import { useState } from "react";
import { Link } from "react-router-dom";
import type { QuizEditorDraftResponse, QuizPublicationDiagnostic, QuizPublicationIssue } from "@poapo/types";
import { ApiError, apiFetch } from "../lib/api";
import type { QuizEditorSession } from "../hooks/useQuizEditorDraft";

const WARNING_GROUPS: Record<string, string> = {
  MISSING_ATTRIBUTES: "Caractéristiques des produits", WEAK_AXIS: "Caractéristiques des produits", NO_AXES: "Caractéristiques des produits",
  MISSING_EMBEDDINGS: "Préparation des recommandations", PENDING_EMBEDDINGS: "Préparation des recommandations", FAILED_EMBEDDINGS: "Préparation des recommandations",
  NO_IMPACT: "Questions", LOW_CONTRAST: "Apparence",
};
/** Les conseils sont regroupés par thème : la liste reste courte et ne masque pas ce qui bloque. */
function warningGroups(items: QuizPublicationIssue[]) {
  const groups = new Map<string, QuizPublicationIssue[]>();
  for (const item of items) { const title = WARNING_GROUPS[item.code] ?? "Autres conseils"; groups.set(title, [...(groups.get(title) ?? []), item]); }
  return [...groups].map(([title, list]) => ({ title, items: list }));
}

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
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [success, setSuccess] = useState("");
  const [confirmed, setConfirmed] = useState(false);
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
        }),
      });
      editor.accept(result);
      onPublished(result, checked);
      setDiagnostic(null); setConfirmed(false);
      setSuccess("Expérience publiée : vos visiteurs voient maintenant cette version.");
      return true;
    } catch (err) {
      const quota = err instanceof ApiError && err.code === "quota_exceeded";
      setQuotaBlocked(quota);
      setError(quota
        ? "Vous avez atteint la limite de quiz en ligne de votre formule : ce quiz ne peut pas être mis en ligne. Désactivez un autre quiz ou changez de formule. Vos modifications restent enregistrées dans le brouillon."
        : `${err instanceof Error ? err.message : "La publication a échoué"} Vos modifications restent enregistrées dans le brouillon : vous pouvez réessayer.`);
      setDiagnostic(null);
      if (err instanceof ApiError && err.status === 409) editor.fail(err);
      return false;
    }
  }
  async function check() {
    onBusyChange(true);
    setBusy(true); setError(""); setQuotaBlocked(false); setSuccess(""); setConfirmed(false);
    await runCheck(revision);
    setBusy(false); onBusyChange(false);
  }
  async function publish() {
    if (!diagnostic || disabled || stale || !confirmed) return;
    setBusy(true); setError(""); setQuotaBlocked(false); setSuccess("");
    onBusyChange(true);
    await runPublish(revision, diagnostic);
    setBusy(false); onBusyChange(false);
  }
  // Enregistre l'activation dans le brouillon, vérifie, puis publie.
  async function publishAndActivate() {
    if (!primaryAction || busy || editor.loading || editor.saving || editor.conflict || pending) return;
    onBusyChange(true);
    setBusy(true); setError(""); setQuotaBlocked(false); setSuccess(""); setConfirmed(false); setDiagnostic(null);
    try {
      const saved = await primaryAction.prepare();
      if (!saved) { setError("Le brouillon n'a pas pu être enregistré."); return; }
      const checked = await runCheck(saved.revision);
      if (!checked || !checked.valid || !checked.hasChanges) return;
      await runPublish(saved.revision, checked);
    } finally { setBusy(false); onBusyChange(false); }
  }
  function issues(items: QuizPublicationIssue[]) {
    return <ul>{items.map((issue, index) => <li key={`${issue.code}:${index}`}>
      <span>{issue.message}</span>{" "}
      {issue.code === "NO_USABLE_ATTRIBUTES" && <a className="btn-ghost btn-sm" data-testid="fix-product-attributes"
        href={`/enrichment?${new URLSearchParams({ ...(diagnostic ? { catalogId: diagnostic.summary.catalogId } : {}), quizId })}`}>Compléter les caractéristiques de mes produits</a>}{" "}
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
    {error && <p className="form-error" role="alert">{error} La publication n'a pas eu lieu.{quotaBlocked
      ? <> <Link to="/settings/subscription">Voir mon abonnement</Link></> : " Réessayez."}</p>}
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
      {diagnostic.warnings.length ? <details className="publication-advice" data-testid="publication-advice" open>
        <summary><strong>Conseils ({diagnostic.warnings.length})</strong> — non bloquants</summary>
        {warningGroups(diagnostic.warnings).map(({ title, items }) => <div key={title}><h4>{title} ({items.length})</h4>{issues(items)}</div>)}
      </details> : <p>Aucun conseil.</p>}
      {diagnostic.valid && diagnostic.hasChanges && <fieldset disabled={disabled} className="publication-confirmation">
        <legend>Confirmer la publication</legend>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Je confirme : mes visiteurs verront cette nouvelle version.</label>
        <button type="button" className="btn-primary"
          disabled={!confirmed}
          onClick={() => void publish()}>Publier</button>
      </fieldset>}
    </>}
  </section>;
}
