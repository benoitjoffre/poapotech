import { Link } from "react-router-dom";
import { useState } from "react";
import type { QuizPublicationDiagnostic } from "@poapo/types";
import { embedSnippet, publicQuizLink } from "../../lib/experienceLinks";
import type { PublicAvailability } from "../../lib/experiences";
import type { PublicationStatus } from "../../lib/publicationStatus";

export function WizardPublicationStatus({ status, error, onRetry }: { status: PublicationStatus | null; error: string; onRetry: () => void }) {
  if (!status) return <div className="xp-state" role="status">
    {error ? <><p className="form-error" role="alert">{error}</p><button type="button" className="btn-ghost" onClick={onRetry}>Réessayer</button></> : "Lecture de l'état de publication…"}
  </div>;
  return <div className={`xw-status ${status.id}`} data-publication-status={status.id} role="status">
    <p><strong>{status.label}</strong></p>
    <p className="section-hint">{status.hint}</p>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="table-link" onClick={onRetry}>Réessayer</button></p>}
    {status.id === "disabled" && status.reason === "Boutique désactivée" && <Link className="btn-ghost" to="/settings">Ouvrir les paramètres</Link>}
  </div>;
}

export function WizardPublished({ tenantId, quizId, availability, published, onCopyError }: {
  tenantId: string; quizId: string; availability: PublicAvailability; published: QuizPublicationDiagnostic["summary"] | null; onCopyError?: (message: string) => void;
}) {
  const [copied, setCopied] = useState("");
  const link = publicQuizLink(tenantId, quizId);
  const copy = (kind: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => setCopied(kind)).catch((err: Error) => onCopyError?.(err.message));
  };
  return <section className="form-section xw-published" aria-labelledby="wizard-published-title" role="status">
    <h2 className="page-title" id="wizard-published-title" tabIndex={-1}>Expérience publiée</h2>
    <ul className="xp-badges">
      <li className="xp-badge public">Publié{published ? ` · ${published.catalogName}` : ""}</li>
      <li className={`xp-badge ${availability.accessible ? "public" : "inactive"}`}>
        {availability.accessible ? "Accessible au public" : `Non accessible au public : ${availability.reason?.toLowerCase()}`}
      </li>
    </ul>
    {!availability.accessible && <p className="xw-note">La version est publiée mais personne ne peut encore l'ouvrir. Utilisez « Publier et rendre accessible », ou activez votre boutique dans les paramètres.</p>}
    <div className="xw-actions">
      {availability.accessible && <button type="button" className="btn-primary" onClick={() => copy("link", link)}>Copier le lien public</button>}
      {availability.accessible && <a className="btn-ghost" href={link} target="_blank" rel="noreferrer">Tester l'expérience publiée</a>}
      <button type="button" className="btn-ghost" onClick={() => copy("code", embedSnippet(tenantId, quizId))}>Copier le code d'intégration</button>
      <Link className="btn-ghost" to={`/analytics?quizId=${encodeURIComponent(quizId)}`}>Voir les résultats</Link>
      <Link className="btn-ghost" to="/quizzes">Retour à Mes expériences</Link>
    </div>
    <p className="xe-muted" role="status" aria-live="polite">{copied === "link" ? "Lien public copié." : copied === "code" ? "Code d'intégration copié." : ""}</p>
    {availability.accessible && <p className="xe-muted">Lien : <a href={link} target="_blank" rel="noreferrer">{link}</a></p>}
  </section>;
}
