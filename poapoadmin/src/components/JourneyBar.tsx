import { Link, useLocation } from "react-router-dom";
import { useJourney } from "../contexts/JourneyContext";
import { homeSteps } from "../lib/journey";
import "./JourneyBar.css";

/** Parcours « mettre mon quiz en ligne », visible sur toutes les pages jusqu'à ce que le quiz soit utilisé. */
export default function JourneyBar() {
  const { summary, justDone } = useJourney();
  const { pathname } = useLocation();
  // L'accueil affiche déjà le guide complet ; la création d'expérience a ses propres trois étapes.
  if (!summary || pathname === "/" || pathname.startsWith("/experiences/new")) return null;
  const steps = homeSteps(summary);
  const current = steps.findIndex((step) => !step.done);
  if (current === -1) return null;
  const step = steps[current];
  const here = pathname === step.to.split("?")[0];
  return <nav className="journey-bar" aria-label="Votre parcours">
    <ol className="journey-steps">
      {steps.map((item, index) => <li key={item.id} className={`journey-step${item.done ? " done" : ""}${index === current ? " current" : ""}`}
        aria-current={index === current ? "step" : undefined}>
        {item.done
          ? <Link to={item.review} aria-label={`${item.title} (terminé)`}><span className="journey-mark" aria-hidden="true">✓</span><span className="journey-label">{item.title}</span></Link>
          : <><span className="journey-mark" aria-hidden="true">{index + 1}</span><span className="journey-label">{item.title}</span></>}
      </li>)}
    </ol>
    <div className="journey-now">
      <p role="status">
        {justDone ? <><strong>{justDone} : terminé ✓</strong> Prochaine étape : {step.title.toLowerCase()}.</>
          : <><strong>Étape {current + 1} sur {steps.length}</strong> · {step.title}</>}
      </p>
      {!here && <Link className="btn-primary btn-sm" to={step.to}>{step.cta}</Link>}
    </div>
  </nav>;
}
