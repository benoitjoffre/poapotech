import { useEffect, useState } from "react";
import type { Quiz, QuizMetricsAIResponse, QuizMetricsResponse } from "@poapo/types";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "../../lib/api";

function formatRate(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function Kpi({ label, value, tag, note }: { label: string; value: string | number; tag?: string; note?: string | null }) {
  return (
    <article className="kpi-card">
      <div className="kpi-label">
        {label}
        {tag && <span className="kpi-tag">{tag}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {note && <p className="kpi-note">{note}</p>}
    </article>
  );
}

/** `since` = début de la période affichée (period.from de l'API Résultats), pour rester aligné sur les chiffres de la page. */
export default function AdvancedAnalytics({ quiz, since: currentSince }: { quiz: Quiz; since: string }) {
  const [metrics, setMetrics] = useState<QuizMetricsResponse | null>(null);
  const [ai, setAi] = useState<QuizMetricsAIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRequested, setAiRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<QuizMetricsResponse>(`/api/quiz/metrics?quizId=${encodeURIComponent(quiz.id)}&since=${encodeURIComponent(currentSince)}`);
      setMetrics(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === "feature_not_included") setLocked(true);
      else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSince]);

  const loadAiInsights = async () => {
    setAiRequested(true);
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

  // Les suggestions ne sont demandées qu'à la demande de l'utilisateur ; un changement de période les invalide.
  useEffect(() => {
    setAi(null);
    setAiRequested(false);
  }, [currentSince]);

  const funnel = metrics?.funnel;
  const indicators = metrics?.indicators;
  const completion = indicators?.completionRate;
  const clicksPer100 = indicators?.clicksPer100Recommendations;
  const unavailable = "Indicateur non fourni par le serveur.";
  const legacyAbandons = funnel?.legacyAbandonEvents ?? 0;

  if (locked) {
    return (
      <div className="analytics-warning" role="status" data-testid="advanced-locked">
        Les analytics avancés ne sont pas inclus dans votre formule. Les résultats essentiels restent disponibles.{" "}
        <Link to="/settings/subscription">Voir mon abonnement</Link>
      </div>
    );
  }

  return (
    <div className="results-advanced">
      {loading && <div className="loading-block">Chargement des métriques...</div>}
      {error && <div className="form-error">{error}</div>}

      {!loading && metrics && (
        <>
          <section className="analytics-kpis" aria-label="Indicateurs calculés">
            {completion?.reliable && completion.value !== null
              ? <Kpi label="Taux de complétion" value={formatRate(completion.value)} note="Quiz terminés / démarrages." />
              : <Kpi label="Taux de complétion" value="Non disponible" note={completion?.reason ?? unavailable} />}
            <Kpi
              label="Clics pour 100 recommandations"
              value={clicksPer100?.value != null ? clicksPer100.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "Non disponible"}
              tag={clicksPer100 && !clicksPer100.reliable && clicksPer100.value != null ? "Indicatif" : undefined}
              note={clicksPer100?.reason ?? (clicksPer100 ? null : unavailable)}
            />
            <Kpi
              label="Abandons récents"
              value={funnel?.abandoned ?? 0}
              tag="Collecte partielle"
              note={`Seuls les abandons détectés par le widget actuel sont comptés.${legacyAbandons > 0 ? ` ${legacyAbandons} ancien(s) événement(s) non fiable(s) exclu(s).` : ""}`}
            />
          </section>

          {indicators && !indicators.consistency.consistent && (
            <div className="analytics-warning" role="status">
              Données partiellement incohérentes : {indicators.completed} quiz terminés pour {indicators.recommendations} recommandations générées.
              Certains événements ont pu être perdus ou proviennent d'une version antérieure du widget.
            </div>
          )}

          <section className="analytics-grid">
            <article className="analytics-panel analytics-ai-panel">
              <div className="analytics-ai-head">
                <h2 className="analytics-panel-title">Suggestions automatiques</h2>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void loadAiInsights()} disabled={aiLoading}>
                  {aiLoading ? "Analyse..." : aiRequested ? "Rafraîchir" : "Générer les suggestions"}
                </button>
              </div>
              {ai && <div className="ai-source">Source : {ai.source === "openai" ? "OpenAI" : "Analyse locale"} · pistes à confirmer avec les chiffres ci-dessus</div>}
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
                {!aiLoading && !aiRequested && <div className="text-muted">Suggestions générées à la demande.</div>}
                {!aiLoading && aiRequested && (!ai || ai.insights.length === 0) && <div className="text-muted">Pas de suggestion disponible pour cette période.</div>}
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Vues et réponses par étape</h2>
              <div className="step-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Étape</th>
                      <th>Vues</th>
                      <th>Réponses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics.steps ?? []).slice(0, 12).map((step) => (
                      <tr key={step.step}>
                        <td>{step.step}</td>
                        <td>{step.views}</td>
                        <td>{step.answers}</td>
                      </tr>
                    ))}
                    {(metrics.steps ?? []).length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-muted">
                          Pas encore de données étape par étape.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="analytics-panel">
              <h2 className="analytics-panel-title">Produits les plus recommandés</h2>
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
              <h2 className="analytics-panel-title">
                Comparaison A/B <span className="kpi-tag">Exploratoire</span>
              </h2>
              {metrics.variants?.length ? (
                <div className="step-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Variante</th>
                        <th>Démarrages</th>
                        <th>Terminés</th>
                        <th>Clics produits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.variants.map((variant) => (
                        <tr key={variant.variant}>
                          <td>{variant.variant}</td>
                          <td>{variant.started}</td>
                          <td>{variant.completed}</td>
                          <td>{variant.clicks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-muted">Volumes bruts, sans test statistique : à utiliser comme tendance, pas comme conclusion.</p>
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

