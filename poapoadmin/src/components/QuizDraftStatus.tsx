export default function QuizDraftStatus({ dirty, hasChanges, saving, conflict, error, onReload, onDiscard, publishHint = "Publiez pour les rendre visibles." }: {
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
      {saving ? "Enregistrement…" : dirty ? "Modifications non enregistrées" :
        hasChanges ? "Modifications enregistrées automatiquement" : "Tout est à jour"}
    </p>
    <p className="section-hint">Vos visiteurs ne voient rien tant que vous n'avez pas publié. {publishHint}</p>
    {error && <div className="form-error" role="alert">{conflict ? "Cette expérience a été modifiée ailleurs. " : "Enregistrement impossible. "}{error} Vos modifications locales sont conservées.</div>}
    <div className="form-actions">
      <button type="button" className="btn-ghost" disabled={saving} onClick={onReload}>Recharger la dernière version enregistrée</button>
      <button type="button" className="btn-danger" disabled={saving || conflict || (!hasChanges && !dirty)} onClick={onDiscard}>Annuler toutes mes modifications non publiées</button>
    </div>
  </section>;
}
