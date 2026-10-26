import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import Icon from "../components/Icon";
import { DashboardPanel, StatCard } from "../components/dashboard/DashboardCard";
import ExperienceCard from "../components/dashboard/ExperienceCard";
import { HomeHero, HomeResources, NextActionCard, ProductsSummary } from "../components/dashboard/HomeSections";
import "../home.css";

export default function HomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<DashboardSummary>("/api/dashboard")
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger votre accueil.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);
  const nextQuiz = summary?.experiences.find((quiz) => quiz.id === summary.nextAction.quizId);
  const helperQuiz = nextQuiz ?? summary?.experiences[0];
  const shopName = summary?.shop.name || summary?.shop.email || user?.email;

  return <div className="home-page">
    <header className="home-account">
      <div className="home-account-identity"><span className="dashboard-icon"><Icon name="box" /></span>
        <div><p>{shopName}</p>{summary?.shop.name && <span className="dashboard-muted">{summary.shop.email}</span>}</div>
      </div>
      <Link className="home-account-settings" to="/settings" aria-label="Paramètres du compte">
        <span aria-hidden="true">{shopName?.trim().slice(0, 2).toUpperCase() || <Icon name="gear" />}</span>
        <Icon name="gear" />
      </Link>
    </header>
    <div className="home-layout">
      <HomeHero />
      {!loading && !error && summary && <NextActionCard action={summary.nextAction}
        experience={nextQuiz} hasExperiences={summary.experiences.length > 0} />}
      {loading ? <div className="dashboard-panel home-state" role="status">Chargement de votre activité…</div>
        : error ? <div className="dashboard-panel home-state"><p className="form-error" role="alert">{error}</p>
          <button className="btn-ghost" type="button" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button></div>
        : summary && <>
          <section className="home-activity" aria-labelledby="home-activity-title">
            <h2 id="home-activity-title" className="home-activity-heading">Votre activité</h2>
            <div className="home-kpis">
              <StatCard label="Quiz commencés" value={summary.totals.started} icon="quiz" caption={`Ces ${summary.period.days} derniers jours`} />
              <StatCard label="Quiz terminés" value={summary.totals.completed} icon="check" caption={`Ces ${summary.period.days} derniers jours`} />
              <StatCard label="Clics vers les produits" value={summary.totals.productClicks} icon="eye" caption={`Ces ${summary.period.days} derniers jours`} />
              <StatCard label="Expériences accessibles" value={summary.totals.accessible} icon="sparkles" caption="Disponibilité actuelle" />
            </div>
            <p className="dashboard-muted home-metric-note">Les clics produits ne sont pas des ventes. Chaque quiz est compté une seule fois, même s'il est partagé entre campagnes.</p>
            {summary.totals.started === 0 && summary.totals.completed === 0 && summary.totals.productClicks === 0 &&
              <p className="dashboard-muted">Aucune activité enregistrée sur cette période. Partagez votre expérience pour recueillir vos premiers résultats.</p>}
          </section>
          <DashboardPanel id="home-experiences-title" title="Vos expériences" icon="sparkles" className="home-experiences-panel"
            action={<Link className="btn-ghost btn-sm" to="/quizzes">Toutes mes expériences →</Link>}>
            {summary.experiences.length === 0 ? <div className="home-empty">
              <h3>Votre première expérience commence ici</h3>
              <p>Choisissez vos produits, préparez vos questions et aidez vos clients à trouver ce qui leur correspond.</p>
              <Link className="btn-primary" to="/experiences/new">Créer ma première expérience</Link>
            </div> : <div className="home-experiences">
              {summary.experiences.map((quiz) => <ExperienceCard key={quiz.id} experience={quiz}
                tenantId={user?.tenantId} days={summary.period.days} />)}
              <Link className="home-create-card" to="/experiences/new">
                <Icon name="plus" size={32} /><strong>Créer une nouvelle expérience</strong>
                <span>Un quiz personnalisé, avec ou sans campagne.</span><span className="btn-ghost">Commencer</span>
              </Link>
            </div>}
            <div className="home-legacy-links"><Link to="/campaigns"><Icon name="megaphone" />Campagnes marketing</Link>
              <span className="dashboard-muted">Un même quiz peut être partagé entre plusieurs campagnes.</span></div>
          </DashboardPanel>
          <ProductsSummary products={summary.products} catalogs={summary.catalogs} />
        </>}
      <HomeResources experience={helperQuiz} />
    </div>
  </div>;
}
