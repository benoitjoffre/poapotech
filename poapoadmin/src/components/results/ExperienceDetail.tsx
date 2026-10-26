import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Quiz, ResultsExperienceDetail } from "@poapo/types";
import { apiFetch } from "../../lib/api";
import { experienceEditorPath } from "../../lib/experienceLinks";
import { METRICS } from "../../lib/results";
import ResultsChart from "./ResultsChart";
import AdvancedAnalytics from "./AdvancedAnalytics";

function Bar({ value, max }: { value: number; max: number }) {
  return <span className="rs-bar" aria-hidden="true"><span style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} /></span>;
}

export default function ExperienceDetail({ quizId, query }: { quizId: string; query: string }) {
  const [detail, setDetail] = useState<ResultsExperienceDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<ResultsExperienceDetail>(`/api/results/experiences/${encodeURIComponent(quizId)}?${query}`)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((err: Error) => { if (!cancelled) { setDetail(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quizId, query]);

  if (loading) return <div className="loading-block" role="status">Chargement du détail...</div>;
  if (error || !detail) return <div className="form-error" role="alert">{error || "Détail indisponible."}</div>;

  const maxViews = Math.max(1, ...detail.questions.map((q) => q.views));
  const maxTop = Math.max(1, ...detail.topProducts.map((p) => p.count));
  const maxClicks = Math.max(1, ...detail.clickedProducts.map((p) => p.count));
  const quiz = { id: quizId, name: detail.experience.name } as Quiz;

  return (
    <div className="rs-detail-body">
      <p className="rs-muted">{detail.experience.catalogName}</p>
      <div className="rs-links">
        <Link className="btn-primary btn-sm" to={experienceEditorPath(quizId)}>Ouvrir l'éditeur</Link>
        <Link className="btn-ghost btn-sm" to="/quizzes">Mes expériences</Link>
      </div>
      <dl className="rs-mini-kpis">
        {METRICS.map((m) => (
          <div key={m.key}><dt>{m.label}</dt><dd>{detail.totals[m.key].toLocaleString("fr-FR")}</dd></div>
        ))}
      </dl>
      <section aria-labelledby="rs-evo"><h3 id="rs-evo">Évolution sur {detail.period.days} jours</h3>
        <ResultsChart daily={detail.daily} title={detail.experience.name} /></section>

      <section aria-labelledby="rs-questions"><h3 id="rs-questions">Questions les plus consultées</h3>
        <p className="rs-muted">Nombre de fois où chaque question a été affichée, et réponses choisies.</p>
        {detail.questions.length === 0 ? <p className="rs-empty">Pas encore de données question par question.</p> : (
          <ol className="rs-list">
            {[...detail.questions].sort((a, b) => b.views - a.views).slice(0, 8).map((q) => (
              <li key={q.questionId}>
                <div className="rs-row"><span>{q.label}</span><strong>{q.views}</strong></div>
                <Bar value={q.views} max={maxViews} />
                {q.options.length > 0 && (
                  <details><summary>{q.answers} réponse{q.answers > 1 ? "s" : ""}</summary>
                    <ul className="rs-options">{q.options.map((o) => <li key={o.answerId}><span>{o.label}</span><span>{o.count}</span></li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {detail.unmatchedSteps > 0 && (
          <p className="rs-muted">{detail.unmatchedSteps} étape{detail.unmatchedSteps > 1 ? "s" : ""} enregistrée{detail.unmatchedSteps > 1 ? "s" : ""} ne correspond plus à une question actuelle et n'est pas affichée.</p>
        )}
      </section>

      <section aria-labelledby="rs-top"><h3 id="rs-top">Produits les plus recommandés</h3>
        {detail.topProducts.length === 0 ? <p className="rs-empty">Aucune recommandation sur cette période.</p> : (
          <ol className="rs-list">{detail.topProducts.map((p) => (
            <li key={p.productId ?? p.name}><div className="rs-row"><span>{p.name}</span><strong>{p.count}</strong></div><Bar value={p.count} max={maxTop} /></li>
          ))}</ol>
        )}
      </section>

      <section aria-labelledby="rs-clicks"><h3 id="rs-clicks">Clics vers les produits</h3>
        {detail.clickedProducts.length === 0 ? <p className="rs-empty">Aucun clic enregistré sur cette période.</p> : (
          <ol className="rs-list">{detail.clickedProducts.map((p) => (
            <li key={p.productId}><div className="rs-row"><span>{p.name}</span><strong>{p.count}</strong></div><Bar value={p.count} max={maxClicks} /></li>
          ))}</ol>
        )}
      </section>

      <section aria-labelledby="rs-ab"><h3 id="rs-ab">Comparaison A/B <span className="kpi-tag">Optionnel</span></h3>
        {detail.variants.length === 0 || (detail.variants.length === 1 && detail.variants[0].variant === "standard")
          ? <p className="rs-empty">Aucune variante A/B active sur cette période.</p>
          : (
            <div className="rs-table-wrap"><table className="table">
              <thead><tr><th scope="col">Variante</th><th scope="col">Démarrages</th><th scope="col">Terminés</th><th scope="col">Clics produits</th></tr></thead>
              <tbody>{detail.variants.map((v) => <tr key={v.variant}><th scope="row">{v.variant}</th><td>{v.started}</td><td>{v.completed}</td><td>{v.clicks}</td></tr>)}</tbody>
            </table><p className="rs-muted">Volumes bruts, sans test statistique : une tendance, pas une conclusion.</p></div>
          )}
      </section>

      <details className="rs-advanced" onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
        <summary>Analyses avancées</summary>
        {advancedOpen && <AdvancedAnalytics quiz={quiz} since={detail.period.from} />}
      </details>
    </div>
  );
}
