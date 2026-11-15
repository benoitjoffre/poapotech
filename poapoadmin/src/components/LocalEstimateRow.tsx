import type { AxisEstimate, QuizAxis } from "@poapo/types";
import { CONFIDENCE_LABELS, formatPercent, levelLabel, type ProductDecisions } from "../lib/productEnrichment";

/** Proposition par règles : niveau lisible et indices textuels, sans curseur ni nombre (le détail chiffré est repliable). */
export default function LocalEstimateRow({ title, axis, estimate, current, invalid, decision, disabled, onChange }: {
  /** Libellé en tête de ligne (nom du produit dans la vue groupée par critère) ; par défaut, le libellé de l'axe. */
  title?: string;
  axis: QuizAxis;
  estimate: AxisEstimate;
  current: number | null;
  invalid: boolean;
  decision: ProductDecisions[string] | undefined;
  disabled: boolean;
  onChange: (patch: Partial<ProductDecisions[string]>) => void;
}) {
  if (!decision) return null;
  const proposed = estimate.status === "estimated" && estimate.value !== null;
  const existing = current !== null || invalid;
  return (
    <div className={`enrichment-row${decision.accepted ? " accepted" : ""}`}>
      <div className="enrichment-row-detail">
        <p>
          <strong>{title ?? axis.label}</strong>{" : "}
          {existing ? <span className="text-muted">valeur déjà renseignée, conservée</span> : (
            <>
              {levelLabel(axis, estimate.value)}
              {proposed && estimate.confidence && (
                <span className={`badge enrichment-confidence enrichment-confidence--${estimate.confidence}`}>{CONFIDENCE_LABELS[estimate.confidence]}</span>
              )}
            </>
          )}
        </p>
        {!existing && <p className="field-hint">{estimate.rationale}</p>}
        {proposed && !existing && estimate.evidence.length > 0 && (
          <p className="field-hint">Indices : {estimate.evidence.map((quote) => `« ${quote} »`).join(", ")}</p>
        )}
        {proposed && !existing && (
          <details className="field-hint">
            <summary>Détail chiffré</summary>
            Valeur proposée : {formatPercent(estimate.value)}
          </details>
        )}
        {proposed && !existing && (
          <label className="checkbox-label">
            <input type="checkbox" checked={decision.accepted} disabled={disabled}
              onChange={(event) => onChange({ accepted: event.target.checked })} />
            Valider « {levelLabel(axis, estimate.value)} »
          </label>
        )}
      </div>
    </div>
  );
}
