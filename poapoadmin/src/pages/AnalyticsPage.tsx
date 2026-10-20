import { useEffect, useMemo, useState } from "react";
import type { Quiz, QuizMetricsAIResponse, QuizMetricsResponse } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { QuizSelector, useQuiz } from "../contexts/QuizContext";

const RANGE_OPTIONS = [
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
] as const;

function formatPercent(value: number): string {
  return `${value}%`;
}

function AnalyticsContent({ quiz }: { quiz: Quiz }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metrics, setMetrics] = useState<QuizMetricsResponse | null>(null);
  const [ai, setAi] = useState<QuizMetricsAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentSince = useMemo(() => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(), [days]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<QuizMetricsResponse>(`/api/quiz/metrics?quizId=${encodeURIComponent(quiz.id)}&since=${encodeURIComponent(currentSince)}`);
      setMetrics(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSince]);

  const loadAiInsights = async () => {
    setAiLoading(true);
    try {
      const data = await apiFetch<QuizMetricsAIResponse>(`/api/quiz/metrics/ai-insights?quizId=${encodeURIComponent(quiz.id)}&since=${encodeURIComponent(currentSince)}`);
      setAi(data);
    } catch {
      setAi(null);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    void loadAiInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSince]);

  const funnel = metrics?.funnel;
  const cta = metrics?.cta;

  const funnelMax = useMemo(() => {
    if (!funnel) return 1;
    return Math.max(funnel.started, funnel.completed, funnel.abandoned, 1);
  }, [funnel]);

  return (
    <div className="page">
      <div className="page-header analytics-header">
        <div>
          <h1 className="page-title">Analytics — {quiz.name}</h1>
          <p className="page-subtitle">Funnel, clics CTA, recommandations et performance A/B</p>
        </div>
        <div className="analytics-range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`btn-ghost ${days === opt.value ? "analytics-range-active" : ""}`}
              onClick={() => setDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="loading-block">Chargement des métriques...</div>}
      {error && <div className="form-error">{error}</div>}

      {!loading && metrics && (
        <>
          <section className="analytics-kpis">
            <article className="kpi-card">
              <div className="kpi-label">Quiz démarrés</div>
              <div className="kpi-value">{funnel?.started ?? 0}</div>
            </article>
            <article className="kpi-card">
              <div className="kpi-label">Quiz complétés</div>
              <div className="kpi-value">{funnel?.completed ?? 0}</div>
            </article>
            <article className="kpi-card">
              <div className="kpi-label">Taux de complétion</div>
              <div className="kpi-value">{formatPercent(funnel?.completionRate ?? 0)}</div>
            </article>
            <article className="kpi-card">
              <div className="kpi-label">Clics CTA</div>
              <div className="kpi-value">{cta?.clicks ?? 0}</div>
            </article>
            <article className="kpi-card">
              <div className="kpi-label">CTR post-résultat</div>
              <div className="kpi-value">{formatPercent(cta?.clickThroughRate ?? 0)}</div>
            </article>
          </section>

          <section className="analytics-grid">
            <article className="analytics-panel analytics-ai-panel">
              <div className="analytics-ai-head">
                <h2 className="analytics-panel-title">Insights IA</h2>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void loadAiInsights()} disabled={aiLoading}>
                  {aiLoading ? "Analyse..." : "Rafraîchir"}
                </button>
              </div>
              {ai && <div className="ai-source">Source: {ai.source === "openai" ? "OpenAI" : "Fallback local"}</div>}
              <div className="ai-insights-list">
                {(ai?.insights ?? []).map((ins, idx) => (
                  <div key={`${ins.title}-${idx}`} className={`ai-insight ai-insight--${ins.priority}`}>
                    <div className="ai-insight-top">
                      <strong>{ins.title}</strong>
                      <span className="ai-priority">{ins.priority}</span>
                    </div>
                    <p>{ins.insight}</p>
                    {ins.actions.length > 0 && (
                      <ul>
                        {ins.actions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {!aiLoading && (!ai || ai.insights.length === 0) && <div className="text-muted">Pas d'insights disponibles pour cette période.</div>}
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Funnel principal</h2>
              <div className="funnel-list">
                {[
                  { key: "Démarrés", value: funnel?.started ?? 0 },
                  { key: "Complétés", value: funnel?.completed ?? 0 },
                  { key: "Abandons", value: funnel?.abandoned ?? 0 },
                ].map((row) => (
                  <div key={row.key} className="funnel-row">
                    <div className="funnel-row-head">
                      <span>{row.key}</span>
                      <strong>{row.value}</strong>
                    </div>
                    <div className="funnel-bar-track">
                      <div className="funnel-bar-fill" style={{ width: `${Math.round((row.value / funnelMax) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Performance par étape</h2>
              <div className="step-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étape</th>
                      <th>Vues</th>
                      <th>Réponses</th>
                      <th>Drop-off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics.steps ?? []).slice(0, 12).map((step) => (
                      <tr key={step.step}>
                        <td>{step.step}</td>
                        <td>{step.views}</td>
                        <td>{step.answers}</td>
                        <td>{formatPercent(step.dropOffRate)}</td>
                      </tr>
                    ))}
                    {(metrics.steps ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-muted">
                          Pas encore de données étape par étape.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Top produits recommandés</h2>
              <div className="top-products-list">
                {(metrics.topProducts ?? []).map((item) => (
                  <div key={item.product.id ?? item.product.name} className="top-product-item">
                    <div>
                      <div className="top-product-name">{item.product.name}</div>
                      <div className="top-product-brand">{item.product.brand ?? "Marque non renseignée"}</div>
                    </div>
                    <div className="top-product-count">{item.count}</div>
                  </div>
                ))}
                {(metrics.topProducts ?? []).length === 0 && <div className="text-muted">Aucune recommandation enregistrée.</div>}
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Feedback utilisateur</h2>
              <div className="feedback-grid">
                <div className="feedback-card">
                  <span>👍 Positif</span>
                  <strong>{metrics.feedback?.positive ?? 0}</strong>
                </div>
                <div className="feedback-card feedback-card--negative">
                  <span>👎 Négatif</span>
                  <strong>{metrics.feedback?.negative ?? 0}</strong>
                </div>
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Performance par variante A/B</h2>
              {metrics.variants?.length ? (
                <div className="step-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Variante</th>
                        <th>Démarrés</th>
                        <th>Complétés</th>
                        <th>Complétion</th>
                        <th>Clics</th>
                        <th>CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.variants.map((variant) => (
                        <tr key={variant.variant}>
                          <td>{variant.variant}</td>
                          <td>{variant.started}</td>
                          <td>{variant.completed}</td>
                          <td>{formatPercent(variant.completionRate)}</td>
                          <td>{variant.clicks}</td>
                          <td>{formatPercent(variant.clickThroughRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {metrics.variants.length === 1 && metrics.variants[0].variant === "standard" && (
                    <p className="text-muted">Aucune variante A/B active sur cette période.</p>
                  )}
                </div>
              ) : (
                <div className="text-muted">Pas encore de données de variantes pour cette période.</div>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const { quiz, loading, error } = useQuiz();
  if (loading) return <div className="loading-block">Chargement des quiz...</div>;
  return <>
    <QuizSelector />
    {error && <div className="form-error">{error}</div>}
    {quiz && <AnalyticsContent key={quiz.id} quiz={quiz} />}
  </>;
}
