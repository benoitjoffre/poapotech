import { Link } from "react-router-dom";
import { useState } from "react";
import type { QuizPublicationDiagnostic } from "@poapo/types";
import { axisExamples, addExampleAxis, WIZARD_STEPS, type AxisExample } from "../../lib/experienceWizard";
import { embedSnippet, publicQuizLink } from "../../lib/experienceLinks";
import type { PublicAvailability } from "../../lib/experiences";
import type { PublicationStatus } from "../../lib/publicationStatus";
import type { QuizConfigForm } from "./QuizConfigFields";

export function WizardStepper({ step, maxReached, complete, onSelect }: {
  step: number; maxReached: number; complete: boolean[]; onSelect: (step: number) => void;
}) {
  return <nav aria-label="Progression de l'assistant" className="xw-stepper">
    <ol>
      {WIZARD_STEPS.map((item, index) => {
        const number = index + 1;
        const reachable = number <= maxReached;
        const status = number === step ? "current" : complete[index] ? "done" : "todo";
        return <li key={item.id}>
          <button type="button" className={`xw-step ${status}`} id={`wizard-step-${number}`} disabled={!reachable} aria-current={number === step ? "step" : undefined}
            onClick={() => onSelect(number)}>
            <span className="xw-step-number" aria-hidden="true">{status === "done" ? "✓" : number}</span>
            <span className="xw-step-label">{item.label}
              <span className="xw-sr"> — étape {number} sur {WIZARD_STEPS.length}{status === "done" ? ", complétée" : ""}</span></span>
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}

export function WizardFooter({ step, busy, canContinue, continueLabel, error, onBack, onContinue, onSaveQuit }: {
  step: number; busy: boolean; canContinue: boolean; continueLabel: string; error: string;
  onBack: () => void; onContinue: () => void; onSaveQuit: () => void;
}) {
  return <div className="xw-footer" role="group" aria-label="Actions de l'assistant">
    {error && <p className="form-error xw-error" role="alert">{error}</p>}
    <button type="button" className="btn-ghost" disabled={step === 1 || busy} onClick={onBack}>← Étape précédente</button>
    <button type="button" className="btn-ghost" disabled={busy} onClick={onSaveQuit}>Enregistrer et quitter</button>
    {step < WIZARD_STEPS.length && <button type="button" className="btn-primary" disabled={busy || !canContinue} onClick={onContinue}>
      {busy ? "Enregistrement…" : continueLabel}</button>}
  </div>;
}

export function WizardProductsIntro({ productCount, loading, catalogId }: { productCount: number; loading: boolean; catalogId: string }) {
  const query = catalogId ? `?catalogId=${encodeURIComponent(catalogId)}` : "";
  return <section className="form-section xw-intro" aria-labelledby="wizard-products-title">
    <h2 className="page-title" id="wizard-products-title">Mes produits</h2>
    <p className="section-hint">Choisissez le catalogue dont l'expérience recommandera les produits, puis ajoutez ou importez ceux qui manquent.</p>
    {!loading && productCount === 0 && <div className="xp-state xp-empty" role="status">
      <p><strong>Aucun produit actif recommandable.</strong> Ajoutez un produit ou importez un fichier CSV dans ce catalogue pour continuer.</p>
      <div className="xe-tools">
        <Link className="btn-primary" to={`/catalog/import${query}`}>Importer un CSV</Link>
        <Link className="btn-ghost" to={`/catalog/new${query}`}>Ajouter un produit</Link>
      </div>
    </div>}
    <p className="xe-muted">L'import CSV ajoute des produits au catalogue choisi uniquement. Il ne synchronise ni ne déduplique rien : chaque ligne valide crée un produit.</p>
    <p className="xe-muted"><strong>Tous les produits actifs</strong> : l'expérience recommande tout le catalogue, y compris les produits ajoutés plus tard.
      <strong> Sélection fixe</strong> : seuls les produits cochés sont recommandés ; les nouveaux produits ne sont pas ajoutés automatiquement.</p>
  </section>;
}

export function WizardPreferencesIntro({ form, setForm }: { form: QuizConfigForm; setForm: (form: QuizConfigForm) => void }) {
  const examples = axisExamples(form.industry);
  const add = (example: AxisExample) => {
    const axis = addExampleAxis(form.axes, example);
    if (axis) setForm({ ...form, axes: [...form.axes, axis] });
  };
  return <section className="form-section xw-intro" aria-labelledby="wizard-prefs-title">
    <h2 className="page-title" id="wizard-prefs-title">Qu'est-ce qui différencie vos produits ?</h2>
    <p className="section-hint">Chaque préférence est une échelle entre deux extrêmes (par exemple « économique ↔ haut de gamme »). Les réponses du quiz positionnent le visiteur sur ces échelles et le produit le plus proche est recommandé.</p>
    <div role="group" aria-label="Exemples de préférences">
      <p className="xe-muted">Exemples{form.industry.trim() ? ` pour « ${form.industry.trim()} »` : ""} — ajoutez-les puis adaptez-les ; vous pouvez aussi saisir les vôtres manuellement :</p>
      <ul className="xw-examples">
        {examples.map((example) => {
          const present = form.axes.some((axis) => axis.label.trim().toLowerCase() === example.label.toLowerCase());
          return <li key={example.label}>
            <button type="button" className="btn-ghost btn-sm" disabled={present || form.axes.length >= 12} onClick={() => add(example)}>
              {present ? "✓ " : "+ "}{example.label} : {example.lowLabel} ↔ {example.highLabel}
            </button>
          </li>;
        })}
      </ul>
    </div>
    {form.axes.length === 0 && <p className="xw-note" role="status">Aucune préférence définie. Vous pouvez continuer, mais la recommandation sera moins précise (le diagnostic le signalera).</p>}
    <p className="xe-muted">Aucune IA n'est nécessaire : la saisie manuelle est complète. Les valeurs de vos produits sur ces échelles se renseignent dans leurs fiches ; une valeur absente reste « non renseignée » (jamais remplacée par 0 ou 0,5).</p>
  </section>;
}

export function WizardActivation({ form, setForm, disabled }: { form: QuizConfigForm; setForm: (form: QuizConfigForm) => void; disabled: boolean }) {
  return <section className="form-section xw-intro" aria-labelledby="wizard-publish-title">
    <h2 className="page-title" id="wizard-publish-title">Vérifier et publier</h2>
    <p className="section-hint">Publier remplace la version publique par la dernière révision enregistrée. Une expérience n'est accessible au public que si elle est publiée, <strong>active</strong> et si votre boutique est active.</p>
    <label className="checkbox-label">
      <input id="wizard-active" type="checkbox" disabled={disabled} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
      Rendre l'expérience accessible au public à la publication
    </label>
    {!form.active && <p className="xe-muted">Sans activation, la publication enregistre la version mais l'expérience reste inaccessible au public.</p>}
  </section>;
}

/** Statut de publication déduit de l'état renvoyé par l'API ; affiché avant toute confirmation de succès. */
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
