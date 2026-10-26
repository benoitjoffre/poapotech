export default function QuizDraftStatus({ dirty, hasChanges, revision, saving, conflict, error, onReload, onDiscard, publishHint = "Vérifiez et publiez depuis l'éditeur de campagne." }: {
  publishHint?: string;
  dirty: boolean;
  hasChanges: boolean;
  revision: number;
  saving: boolean;
  conflict: boolean;
  error: string;
  onReload: () => void;
  onDiscard: () => void;
}) {
  return <section className="form-section" aria-label="État du brouillon">
    <p role="status">
      {saving ? "Sauvegarde en cours…" : dirty ? "Modifications non enregistrées" :
        hasChanges ? `Brouillon enregistré · révision ${revision}` : "Aucune modification préparatoire enregistrée"}
    </p>
    <p className="section-hint">L'enregistrement du brouillon ne modifie pas le contenu public. {publishHint}</p>
    {error && <div className="form-error" role="alert">{conflict ? "Conflit de révision. " : "Erreur de sauvegarde / chargement. "}{error} Vos modifications locales sont conservées.</div>}
    <div className="form-actions">
      <button type="button" className="btn-ghost" disabled={saving} onClick={onReload}>Recharger le brouillon serveur</button>
      <button type="button" className="btn-danger" disabled={saving || conflict || (!hasChanges && !dirty)} onClick={onDiscard}>Abandonner les modifications préparatoires</button>
    </div>
  </section>;
}
