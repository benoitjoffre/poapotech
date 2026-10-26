import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import type { TourStep } from "./tourSteps";
import { findTarget, usePlacement } from "./tourPosition";
import "./tour.css";

interface Props {
  mode: "offer" | "tour";
  steps: TourStep[];
  index: number;
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function TourOverlay({ mode, steps, index, onStart, onPrev, onNext, onSkip, onFinish }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const touring = mode === "tour";
  const stepKey = touring ? step.id : "offer";
  const placement = usePlacement(touring ? step.target : undefined, cardRef, stepKey);
  const centered = placement.card === null;
  const last = index === steps.length - 1;
  const targetMissing = touring && !!step.target && !findTarget(step.target);

  // Make the app behind the overlay unreachable by pointer, keyboard and screen reader.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.inert = true;
    return () => { root.inert = false; };
  }, []);

  // Initial focus and focus on each step: the card itself, so its label and description are announced.
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, [stepKey]);

  // Escape quits at any time; Tab loops inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onSkip(); return; }
      if (e.key !== "Tab" || !cardRef.current) return;
      const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0], lastEl = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === cardRef.current)) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && current === lastEl) { e.preventDefault(); first.focus(); }
      else if (!cardRef.current.contains(current)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onSkip]);

  const cardStyle: CSSProperties | undefined = placement.card ? { top: placement.card.top, left: placement.card.left } : undefined;
  const spot = placement.spot;

  return createPortal(
    <div className="tour-root" data-tour-overlay>
      {/* Blocks accidental clicks on the dimmed page. */}
      <div className={`tour-backdrop${spot ? "" : " tour-backdrop--dim"}`} aria-hidden="true" />
      {spot && <div className="tour-spot" aria-hidden="true"
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />}
      <div ref={cardRef} className={`tour-card${centered ? " tour-card--center" : ""}`} style={cardStyle}
        role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-desc" tabIndex={-1}
        data-tour-card data-tour-mode={centered ? "informative" : "anchored"}>
        {touring ? <>
          <p className="tour-progress">Étape {index + 1} sur {steps.length}</p>
          <h2 id="tour-title" className="tour-title">{step.title}</h2>
          <div id="tour-desc" className="tour-body">
            <p>{step.body}</p>
            {step.points && <ul>{step.points.map((p) => <li key={p}>{p}</li>)}</ul>}
            {step.note && <p className="tour-note">{step.note}</p>}
            {targetMissing && <p className="tour-note">L'élément présenté n'est pas affiché pour le moment.</p>}
          </div>
          <div className="tour-actions">
            <button type="button" className="tour-skip" onClick={onSkip}>Passer la visite</button>
            <span className="tour-nav">
              {index > 0 && <button type="button" className="btn-ghost btn-sm" onClick={onPrev}>Précédent</button>}
              {last
                ? <button type="button" className="btn-primary btn-sm" onClick={onFinish}>Terminer</button>
                : <button type="button" className="btn-primary btn-sm" onClick={onNext}>Suivant <Icon name="arrow" size={14} /></button>}
            </span>
          </div>
        </> : <>
          <button type="button" className="tour-close" aria-label="Fermer" onClick={onSkip}>×</button>
          <h2 id="tour-title" className="tour-title tour-title--lg">Bienvenue sur POAPO !</h2>
          <div id="tour-desc" className="tour-body">
            <p>Découvrez comment créer votre première expérience de recommandation en quelques étapes. Cette visite est facultative et dure environ 3 minutes.</p>
          </div>
          <div className="tour-actions">
            <button type="button" className="tour-skip" onClick={onSkip}>Passer la visite</button>
            <button type="button" className="btn-primary btn-sm" onClick={onStart}>Commencer la visite <Icon name="arrow" size={14} /></button>
          </div>
        </>}
      </div>
    </div>,
    document.body,
  );
}
