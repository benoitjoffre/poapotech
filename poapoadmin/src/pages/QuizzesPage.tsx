import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ExperiencesOverview } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { CatalogSelect, useCatalogSelection } from "../lib/catalogs";
import {
  filterExperiences, sortExperiences, quizStatus, matchesQuizFilter,
  type ExperienceSort, type QuizFilter,
} from "../lib/experiences";
import Icon from "../components/Icon";
import ExperienceCard from "../components/experiences/ExperienceCard";
import "../components/experiences/experiences.css";
import "../components/experiences/quizList.css";

export default function QuizzesPage() {
  const { user } = useAuth();
  const { catalogs, catalogId, setCatalogId } = useCatalogSelection({ allowAll: true });
  const [overview, setOverview] = useState<ExperiencesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuizFilter>("all");
  const [sort, setSort] = useState<ExperienceSort>("recent");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<ExperiencesOverview>("/api/experiences")
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger vos quiz."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const all = useMemo(() => overview?.experiences ?? [], [overview]);
  const shopActive = overview?.shopActive ?? true;
  const inCatalog = useMemo(() => filterExperiences(all, { query: "", availability: "all", draft: "all", catalogId }), [all, catalogId]);
  const visible = useMemo(() => sortExperiences(filterExperiences(all, { query, availability: "all", draft: "all", catalogId }), sort)
    .filter((item) => matchesQuizFilter(quizStatus(item, shopActive), filter)), [all, query, catalogId, sort, filter, shopActive]);
  const days = overview?.period.days ?? 30;
  const count = (value: QuizFilter) => inCatalog.filter((item) => matchesQuizFilter(quizStatus(item, shopActive), value)).length;
  const createPath = catalogId ? `/experiences/new?catalogId=${encodeURIComponent(catalogId)}` : "/experiences/new";
  const filtered = !!query || filter !== "all" || !!catalogId;
  const tabs: { value: QuizFilter; label: string }[] = [
    { value: "all", label: "Tous" }, { value: "online", label: "En ligne" }, { value: "to-finish", label: "À terminer" },
  ];

  return <div className="page experiences-page quiz-list-page">
    <header className="page-header">
      <div>
        <h1 className="page-title">Mes quiz</h1>
        <p className="page-subtitle">Créez et gérez vos quiz de recommandation.</p>
      </div>
      <Link className="btn-primary" to={createPath}><Icon name="plus" size={16} />&nbsp;Créer un quiz</Link>
    </header>

    {loading && <div className="loading-block" role="status">Chargement de vos quiz…</div>}
    {error && <div className="xp-state"><p className="form-error" role="alert">{error}</p>
      <button type="button" className="btn-ghost" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button></div>}

    {!loading && !error && overview && (all.length === 0 ? <div className="xp-state xp-empty">
      <h2>Vous n'avez pas encore de quiz</h2>
      <p>Un quiz guide vos clients vers les produits d'un catalogue grâce à quelques questions.</p>
      <Link className="btn-primary" to={createPath}>Créer mon premier quiz</Link>
    </div> : <>
      <div className="qz-toolbar" role="search">
        <div className="qz-search">
          <Icon name="search" size={16} />
          <input id="xp-search" type="search" aria-label="Rechercher un quiz" value={query} placeholder="Rechercher un quiz…"
            onChange={(event) => setQuery(event.target.value)} />
        </div>
        {all.length > 1 && <div className="qz-tabs" role="group" aria-label="Filtrer les quiz">
          {tabs.map((tab) => <button key={tab.value} type="button" aria-pressed={filter === tab.value}
            className={`qz-tab${filter === tab.value ? " active" : ""}`} onClick={() => setFilter(tab.value)}>
            {tab.label} ({count(tab.value)})</button>)}
        </div>}
        {(catalogs.length > 1 || all.length > 1) && <details className="qz-options">
          <summary>Options</summary>
          <div className="qz-options-body">
            <CatalogSelect catalogs={catalogs} value={catalogId} onChange={setCatalogId} allowAll />
            <div className="field-group">
              <label className="field-label" htmlFor="xp-sort">Trier par</label>
              <select id="xp-sort" className="field-select" value={sort} onChange={(event) => setSort(event.target.value as ExperienceSort)}>
                <option value="recent">Dernière modification</option>
                <option value="name">Nom</option>
              </select>
            </div>
          </div>
        </details>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{visible.length} quiz affiché{visible.length > 1 ? "s" : ""}</p>

      <section className="qz-list" aria-label="Liste des quiz">
        {visible.length === 0 ? <div className="xp-state">
          <p>{filtered ? "Aucun quiz ne correspond à votre recherche." : "Aucun quiz."}</p>
          {filtered && <button type="button" className="btn-ghost" onClick={() => { setQuery(""); setFilter("all"); setCatalogId(""); }}>Effacer les filtres</button>}
        </div> : visible.map((item) => <ExperienceCard key={item.id} experience={item}
          tenantId={user?.tenantId} days={days} shopActive={shopActive} />)}
      </section>
    </>)}
  </div>;
}
