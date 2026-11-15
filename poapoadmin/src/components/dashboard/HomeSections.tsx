import { Link } from "react-router-dom";
import type { DashboardExperience } from "@poapo/types";
import { experienceEditorPath } from "../../lib/experienceLinks";
import Icon from "../Icon";
import type { HomeState, Step } from "../../lib/journey";

const GUIDE_TITLE = { new: "Votre quiz en trois étapes", progress: "Reprenez votre quiz", live: "Votre progression" } as const;

/**
 * Guide unique de l'accueil : mêmes étapes que la barre de parcours.
 * Carte de trois étapes avant publication ; panneau « Votre progression » à quatre étapes une fois le quiz en ligne.
 * L'installation n'est jamais affichée comme terminée : POAPO ne peut pas la vérifier.
 */
export function HomeGuide({ steps, state }: { steps: Step[]; state: HomeState }) {
  const panel = state.kind === "live";
  const visible = (panel ? steps : steps.slice(0, 3)).map((step) => ({ ...step, done: step.id === "site" ? false : step.done }));
  const current = visible.findIndex((step) => !step.done);
  if (current === -1) return null;
  const done = visible.filter((step) => step.done).length;
  const step = visible[current];
  const resume = state.kind === "progress" && step.id === "publish" && state.quiz;
  const intro = state.kind === "new" && !steps[0].done
    ? "POAPO prépare un quiz à partir de vos produits : vos clients répondent à quelques questions et reçoivent la sélection qui leur correspond."
    : null;
  return <section className={`home-guide${panel ? " home-guide--panel" : ""}`} aria-labelledby="home-guide-title">
    <h2 id="home-guide-title">{GUIDE_TITLE[state.kind]}{!panel && <span className="home-guide-count"> {done} étape{done > 1 ? "s" : ""} sur {visible.length}</span>}</h2>
    {intro && <p className="home-guide-intro">{intro}</p>}
    <ol className="home-steps">
      {visible.map((item, index) => <li key={item.id} className={`home-step${item.done ? " done" : ""}${index === current ? " current" : ""}`}
        aria-current={index === current ? "step" : undefined}>
        <span className="home-step-mark" aria-hidden="true">{item.done ? "✓" : index + 1}</span>
        <div className="home-step-body">
          <strong>{item.title}{item.done && <span className="sr-only"> (terminé)</span>}</strong>
          {index === current && <>
            <p>{item.id === "site" ? "Intégrez le quiz à votre boutique pour le rendre visible à vos clients." : item.help}</p>
            {resume && <div className="home-resume" data-testid="home-resume">
              <p><strong>{resume.name}</strong><span className="home-quiz-status">{resume.hasDraft ? "Brouillon" : "Pas encore publié"}</span></p>
              <p>{state.nextText}</p>
            </div>}
            <Link className="btn-primary" to={item.to} aria-label={resume ? `Continuer mon quiz : ${item.cta.toLowerCase()}` : undefined}>{resume ? "Continuer mon quiz" : item.cta}</Link>
            {item.id === "site" && <p className="home-install-note dashboard-muted" data-testid="home-install-note"><Icon name="help" size={14} /> POAPO ne peut pas vérifier automatiquement l'installation sur votre site.</p>}
          </>}
        </div>
      </li>)}
    </ol>
  </section>;
}

/** Bandeau de situation du quiz en ligne : n'affirme jamais une installation, seulement ce que les données montrent. */
export function HomeBanner({ used }: { used: boolean }) {
  return <p className={`home-banner${used ? " success" : ""}`} role="status" data-testid="home-banner">
    <Icon name="check" size={20} />
    {used ? "Votre quiz est en ligne et a déjà reçu des réponses !" : "Votre quiz est en ligne. Aucun visiteur ne l'a encore commencé."}
  </p>;
}

export function HomeExperienceRow({ experience }: { experience: DashboardExperience }) {
  const status = experience.accessible ? (experience.hasDraft ? "En ligne · modifications non publiées" : "En ligne")
    : experience.hasDraft ? "Brouillon" : "Pas encore publié";
  // « Résultats » n'a de sens que pour un quiz visible ou déjà utilisé.
  const hasResults = experience.accessible || experience.started > 0;
  return <li className={`home-quiz-row${experience.accessible ? " live" : ""}`}>
    <span className="home-quiz-thumb" aria-hidden="true"><Icon name="quiz" size={20} /></span>
    <div className="home-quiz-main">
      <strong>{experience.name}</strong>
      <span className={`home-quiz-status${experience.accessible ? " live" : ""}`}>{status}</span>
      {experience.correction && <p className="dashboard-muted">{experience.correction}</p>}
    </div>
    <div className="home-quiz-actions">
      {hasResults && <Link className="btn-ghost btn-sm" to={`/analytics?quizId=${encodeURIComponent(experience.id)}`}><Icon name="chart" size={15} /> Résultats</Link>}
      <Link className="btn-ghost btn-sm" to={experienceEditorPath(experience.id)}><Icon name="edit" size={15} /> Modifier</Link>
    </div>
  </li>;
}
