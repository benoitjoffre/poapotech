import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useJourney } from "../contexts/JourneyContext";
import { StatCard } from "../components/dashboard/DashboardCard";
import { HomeBanner, HomeExperienceRow, HomeGuide } from "../components/dashboard/HomeSections";
import Icon from "../components/Icon";
import { createdQuizzes, homeState, homeSteps } from "../lib/journey";
import "../home.css";

const SUBTITLE = {
  new: "Bienvenue sur POAPO : votre quiz aide vos clients à trouver le bon produit.",
  progress: "Reprenez là où vous vous êtes arrêté.",
  live: "Voici ce qui se passe avec vos quiz.",
} as const;

export default function HomePage() {
  const { user } = useAuth();
  const { summary, loading, error, reload } = useJourney();
  const shopName = summary?.shop.name || user?.email || "";
  const state = summary ? homeState(summary) : null;
  const steps = summary ? homeSteps(summary) : [];
  const created = summary ? createdQuizzes(summary) : [];
  // Les quiz en ligne d'abord ; pas de chiffres tant qu'aucun visiteur n'a commencé un quiz.
  const quizzes = [...created].sort((a, b) => Number(b.accessible) - Number(a.accessible));
  const live = state?.kind === "live";

  return <div className="home-page">
    <header className="home-welcome">
      <div>
        <h1 id="home-title">Bonjour{shopName ? ` ${shopName}` : ""} <span aria-hidden="true">👋</span></h1>
        <p>{state ? SUBTITLE[state.kind] : SUBTITLE.new}</p>
      </div>
      {live && <Link className="btn-ghost home-create" to="/experiences/new"><Icon name="plus" size={16} /> Créer un nouveau quiz</Link>}
    </header>
    {loading ? <div className="dashboard-panel home-state" role="status">Chargement…</div>
      : error ? <div className="dashboard-panel home-state"><p className="form-error" role="alert">{error}</p>
        <button className="btn-ghost" type="button" onClick={reload}>Réessayer</button></div>
      : summary && state && (live
        ? <div className="home-grid">
          <div className="home-main">
            <HomeBanner used={state.used} />
            {state.used && <section className="home-activity" aria-labelledby="home-activity-title">
              <h2 id="home-activity-title" className="sr-only">Vos résultats, {summary.period.days} derniers jours</h2>
              <div className="home-kpis">
                <StatCard label="Quiz commencés" value={summary.totals.started} icon="quiz" />
                <StatCard label="Quiz terminés" value={summary.totals.completed} icon="check" />
                <StatCard label="Clics vers vos produits" value={summary.totals.productClicks} icon="eye" caption="Ce ne sont pas des ventes" />
              </div>
            </section>}
            <section className="home-quizzes" aria-labelledby="home-quizzes-title">
              <div className="home-quizzes-head"><h2 id="home-quizzes-title">Vos quiz</h2><span className="home-count">{quizzes.length} quiz</span></div>
              <ul className="home-quiz-list">{quizzes.map((quiz) => <HomeExperienceRow key={quiz.id} experience={quiz} />)}</ul>
              <Link className="btn-ghost btn-sm" to="/experiences/new">+ Créer un autre quiz</Link>
            </section>
          </div>
          <aside className="home-aside"><HomeGuide steps={steps} state={state} /></aside>
        </div>
        : <HomeGuide steps={steps} state={state} />)}
  </div>;
}
