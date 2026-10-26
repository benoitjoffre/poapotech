import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ResultsSummary } from "@poapo/types";
import { apiFetch } from "../lib/api";
import {
  METRICS, RANGES, filterExperiences, formatTrend, periodQuery, sortExperiences, trend,
  type Range, type SortKey,
} from "../lib/results";
import ResultsChart from "../components/results/ResultsChart";
import ExperienceDetail from "../components/results/ExperienceDetail";
import "./results.css";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "started", label: "Démarrages" },
  { key: "completed", label: "Quiz terminés" },
  { key: "recommendations", label: "Recommandations" },
  { key: "productClicks", label: "Clics produits" },
  { key: "name", label: "Nom" },
];

export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState<Range>(30);
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [sort, setSort] = useState<SortKey>("started");

  // La fenêtre est figée par période choisie : une nouvelle requête n'est émise qu'au changement de période ou « Réessayer ».
  const query = useMemo(() => periodQuery(days), [days, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<ResultsSummary>(`/api/results/summary?${query}`)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((err: Error) => { if (!cancelled) { setSummary(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const rows = useMemo(
    () => sortExperiences(filterExperiences(summary?.experiences ?? [], search, catalogId), sort),
    [summary, search, catalogId, sort]);
  const requested = params.get("quizId");
  const selectedId = (summary?.experiences.some((e) => e.id === requested) ? requested : null) ?? rows[0]?.id ?? null;
  const selected = summary?.experiences.find((e) => e.id === selectedId) ?? null;
  const fromCampaign = params.get("from") === "campaign";
  const select = (id: string) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("quizId", id); return next; }, { replace: true });
  const hasAny = (summary?.experiences.length ?? 0) > 0;
  const noEvents = summary ? METRICS.every((m) => summary.totals[m.key] === 0) : false;

  return (
    <div className="page rs-page">
      <header className="page-header rs-header">
        <div>
          <h1 className="page-title">Résultats</h1>
          <p className="page-subtitle">Suivez l'utilisation de vos expériences et comprenez ce qui intéresse vos visiteurs.</p>
        </div>
        <div className="rs-range" role="group" aria-label="Période">
          {RANGES.map((value) => (
            <button key={value} type="button" className="btn-ghost" aria-pressed={days === value}
              onClick={() => setDays(value)}>{value} jours</button>
          ))}
        </div>
      </header>

      {fromCampaign && (
        <p className="rs-banner" role="note">
          <strong>Résultats de l'expérience associée.</strong> Ces chiffres concernent l'expérience entière, y compris
          lorsqu'elle est utilisée par plusieurs campagnes : ils ne sont pas calculés par campagne.
        </p>
      )}

      {loading && <div className="loading-block" role="status">Chargement des résultats...</div>}
      {error && (
        <div className="form-error" role="alert">
          {error} <button type="button" className="btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>Réessayer</button>
        </div>
      )}

      {!loading && summary && !hasAny && (
        <section className="rs-card rs-empty-state">
          <h2>Aucune expérience pour le moment</h2>
          <p>Créez votre première expérience : ses résultats apparaîtront ici dès que des visiteurs l'utiliseront.</p>
          <Link className="btn-primary" to="/experiences/new">Créer une expérience</Link>
        </section>
      )}

      {!loading && summary && hasAny && (
        <>
          {summary.truncated && (
            <div className="analytics-warning" role="status">
              Résultats partiels : seules les {summary.quizLimit} premières expériences sont comptées dans les totaux et la courbe.
              Filtrez par catalogue pour afficher les autres.
            </div>
          )}
          <section className="rs-kpis" aria-label="Indicateurs principaux">
            {METRICS.map((m) => {
              const change = trend(summary.totals[m.key], summary.previous[m.key]);
              return (
                <article key={m.key} className="rs-kpi">
                  <h2 className="rs-kpi-label">{m.label}</h2>
                  <p className="rs-kpi-value">{summary.totals[m.key].toLocaleString("fr-FR")}</p>
                  <p className={`rs-kpi-trend${change === null ? " rs-muted" : change < 0 ? " rs-down" : ""}`}>
                    {formatTrend(change)}{change !== null && <span className="rs-muted"> vs {summary.period.days} jours précédents</span>}
                  </p>
                  <p className="rs-help">{m.help}</p>
                </article>
              );
            })}
          </section>

          {noEvents && (
            <p className="rs-banner" role="status">Aucune donnée enregistrée sur cette période. Essayez une période plus longue ou partagez votre expérience.</p>
          )}

          <section className="rs-card" aria-labelledby="rs-evolution">
            <h2 id="rs-evolution">Évolution des indicateurs</h2>
            <ResultsChart daily={summary.daily} title="Toutes les expériences" />
          </section>

          <div className="rs-layout">
            <section className="rs-card" aria-labelledby="rs-perf">
              <h2 id="rs-perf">Performances par expérience</h2>
              <p className="rs-muted">Comparez vos expériences et repérez celles qui génèrent le plus d'engagement. Chaque expérience est comptée une seule fois, même si plusieurs campagnes l'utilisent.</p>
              <div className="rs-filters">
                <label className="rs-field"><span>Rechercher</span>
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une expérience" /></label>
                <label className="rs-field"><span>Catalogue</span>
                  <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
                    <option value="">Tous les catalogues</option>
                    {summary.catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <label className="rs-field"><span>Trier par</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select></label>
              </div>
              {rows.length === 0 ? <p className="rs-empty">Aucune expérience ne correspond à ces filtres.</p> : (
                <div className="rs-table-wrap">
                  <table className="table rs-table">
                    <thead><tr>
                      <th scope="col">Expérience</th><th scope="col">Catalogue</th>
                      <th scope="col">Démarrages</th><th scope="col">Terminés</th>
                      <th scope="col">Recommandations</th><th scope="col">Clics produits</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr></thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className={row.id === selectedId ? "rs-selected" : undefined}>
                          <th scope="row" data-label="Expérience">{row.name}{!row.active && <span className="kpi-tag">Désactivée</span>}</th>
                          <td data-label="Catalogue">{row.catalogName}</td>
                          <td data-label="Démarrages">{row.started}</td>
                          <td data-label="Terminés">{row.completed}</td>
                          <td data-label="Recommandations">{row.recommendations}</td>
                          <td data-label="Clics produits">{row.productClicks}</td>
                          <td className="rs-action">
                            <button type="button" className="btn-ghost btn-sm" aria-current={row.id === selectedId ? "true" : undefined}
                              onClick={() => select(row.id)}>Voir<span className="sr-only"> le détail de {row.name}</span></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <aside className="rs-card rs-detail" aria-labelledby="rs-detail-title" aria-live="polite">
              <h2 id="rs-detail-title">Détail{selected ? ` — ${selected.name}` : ""}</h2>
              {selectedId
                ? <ExperienceDetail key={selectedId} quizId={selectedId} query={query} />
                : <p className="rs-empty">Choisissez une expérience pour voir son détail.</p>}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
