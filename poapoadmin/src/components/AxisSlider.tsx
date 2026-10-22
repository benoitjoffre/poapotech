import type { ReactNode } from "react";
import type { QuizAxis } from "@poapo/types";

/**
 * Curseur 0–1 d'un axe de recommandation. `value` vide = non renseigné (le curseur s'affiche au milieu).
 */
export default function AxisSlider({ id, axis, value, onChange, disabled, hint, clearable = true }: {
  id: string;
  axis: QuizAxis;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: ReactNode;
  clearable?: boolean;
}) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {axis.label}
        <span className="field-hint"> {value === "" ? "non renseigné" : `${Math.round(parseFloat(value) * 100)}%`}</span>
        {hint}
      </label>
      <input
        id={id}
        className="field-input"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value === "" ? 0.5 : value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="axis-scale">
        <span className="field-hint">{axis.lowLabel || "Faible"}</span>
        {clearable && value !== "" && !disabled && (
          <button type="button" className="btn-link" onClick={() => onChange("")}>
            Effacer
          </button>
        )}
        <span className="field-hint">{axis.highLabel || "Élevé"}</span>
      </div>
    </div>
  );
}
