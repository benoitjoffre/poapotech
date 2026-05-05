import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface VerbatimItem {
  text?: string;
  [key: string]: unknown;
}

interface TopPerfumeItem {
  name?: string;
  count?: number;
}

type StatEntry = Record<string, number | string | object>;

interface DashboardMetrics {
  counts?: Record<string, number>;
  rates?: Record<string, number>;
  verbatims?: (string | VerbatimItem)[];
  topPerfumes?: TopPerfumeItem[];
  genderStats?: {
    counts?: Record<string, number>;
    percents?: Record<string, number>;
  };
  decisionTime?: StatEntry;
  decision_time?: StatEntry;
  profileUnivers?: StatEntry;
  families?: StatEntry;
  variants?: StatEntry;
}

function DashboardPage() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const genderOrder = ["male", "female", "any", "unknown"];
  const genderLabels: Record<string, string> = {
    male: "Homme",
    female: "Femme",
    any: "Unisexe",
    unknown: "Inconnu",
  };

  const formatPercent = (value: number | unknown): string => {
    if (typeof value !== "number" || Number.isNaN(value)) return "0";
    return value.toFixed(1).replace(/\.0$/, "");
  };

  const formatValue = (value: unknown): string => {
    if (typeof value === "number") return value.toString();
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "0";
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return "0";
      return entries.map(([key, v]) => `${key}: ${v ?? 0}`).join(" · ");
    }
    return String(value);
  };

  const formatDurationMs = (value: unknown): string => {
    if (typeof value !== "number" || Number.isNaN(value)) return "0 s";
    const totalSeconds = Math.max(0, Math.round((value as number) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
      return `${seconds} s`;
    }
    return `${minutes} min ${seconds} s`;
  };

  const toEntries = (data: unknown, { labelKey = "name", valueKey = "count" } = {}): { label: string; value: unknown }[] => {
    if (!data) return [];
    if (Array.isArray(data)) {
      return (data as Record<string, unknown>[]).map((item) => ({
        label: String(item?.[labelKey] ?? item?.["label"] ?? item?.["name"] ?? "—"),
        value: item?.[valueKey] ?? item?.["value"] ?? item?.["count"] ?? item?.["percent"] ?? 0,
      }));
    }
    if (typeof data === "object") {
      return Object.entries(data as Record<string, unknown>).map(([label, value]) => ({ label, value }));
    }
    return [];
  };

  const loadMetrics = async () => {
    setIsLoadingMetrics(true);
    setMetricsError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/quiz/metrics`);
      if (!response.ok) throw new Error("Impossible de charger les métriques.");
      const data = (await response.json()) as DashboardMetrics;
      setMetrics(data);
    } catch (err) {
      setMetricsError((err as Error).message || "Erreur lors du chargement des métriques.");
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-header">
        <div>
          <div className="dashboard-title">Dashboard quiz</div>
          <div className="dashboard-subtitle">Metrics temps réel pour le suivi du quiz.</div>
        </div>
        <div className="dashboard-page-actions">
          <Link className="secondary page-link" to="/">
            Retour au quiz
          </Link>
          <button type="button" className="secondary dashboard-refresh" onClick={loadMetrics} disabled={isLoadingMetrics}>
            {isLoadingMetrics ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
      </div>

      <section className="dashboard">
        {metricsError && <div className="form-error">{metricsError}</div>}
        {metrics && (
          <>
            <div className="dashboard-grid">
              <div className="dashboard-card">
                <div className="dashboard-label">
                  Quiz démarrés
                  <span className="info-pill" data-tooltip="Nombre total de quiz commencés." aria-label="Nombre total de quiz commencés.">
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.counts?.quiz_start ?? metrics.counts?.quizStarted ?? 0}</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  Quiz complétés
                  <span
                    className="info-pill"
                    data-tooltip="Nombre total de quiz arrivés jusqu’à la validation."
                    aria-label="Nombre total de quiz arrivés jusqu’à la validation."
                  >
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.counts?.quiz_complete ?? metrics.counts?.quizCompleted ?? 0}</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  % complétion
                  <span
                    className="info-pill"
                    data-tooltip="Taux de quiz complétés sur les quiz démarrés."
                    aria-label="Taux de quiz complétés sur les quiz démarrés."
                  >
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.rates?.quiz_complete ?? metrics.rates?.completionPercent ?? 0}%</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  Clics acheter
                  <span
                    className="info-pill"
                    data-tooltip="Nombre de clics sur le bouton d’achat."
                    aria-label="Nombre de clics sur le bouton d’achat."
                  >
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.counts?.buy_click ?? metrics.counts?.buyClicks ?? 0}</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  % clic acheter
                  <span
                    className="info-pill"
                    data-tooltip="Taux de clics achat sur les quiz complétés."
                    aria-label="Taux de clics achat sur les quiz complétés."
                  >
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.rates?.buy_click ?? metrics.rates?.buyClickPercent ?? 0}%</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  Feedback 👍
                  <span className="info-pill" data-tooltip="Feedback positifs." aria-label="Feedback positifs.">
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.counts?.feedback_up ?? metrics.counts?.feedbackUp ?? 0}</div>
              </div>
              <div className="dashboard-card">
                <div className="dashboard-label">
                  Feedback 👎
                  <span className="info-pill" data-tooltip="Feedback négatifs." aria-label="Feedback négatifs.">
                    i
                  </span>
                </div>
                <div className="dashboard-value">{metrics.counts?.feedback_down ?? metrics.counts?.feedbackDown ?? 0}</div>
              </div>
            </div>
            <div className="dashboard-verbatims">
              <div className="dashboard-label">
                Derniers verbatims
                <span className="info-pill" data-tooltip="Les 5 derniers retours texte soumis." aria-label="Les 5 derniers retours texte soumis.">
                  i
                </span>
              </div>
              {(metrics.verbatims || []).length === 0 ? (
                <div className="dashboard-empty">Aucun verbatim pour l’instant.</div>
              ) : (
                <ul className="verbatim-list">
                  {(metrics.verbatims ?? []).slice(0, 5).map((item, index) => {
                    const text = typeof item === "string" ? item : ((item as VerbatimItem)?.text ?? "");
                    return <li key={`${text || "verbatim"}-${index}`}>{text}</li>;
                  })}
                </ul>
              )}
            </div>
            <div className="dashboard-extra">
              <div className="dashboard-panel">
                <div className="dashboard-label">
                  Stats genres
                  <span
                    className="info-pill"
                    data-tooltip="Répartition des genres déclarés au début du quiz."
                    aria-label="Répartition des genres déclarés au début du quiz."
                  >
                    i
                  </span>
                </div>
                <ul className="stat-list">
                  {genderOrder.map((key) => {
                    const count = metrics.genderStats?.counts?.[key] ?? 0;
                    const percent = metrics.genderStats?.percents?.[key] ?? 0;
                    return (
                      <li className="stat-item" key={key}>
                        <span>{genderLabels[key]}</span>
                        <span className="stat-value">
                          {count} · {formatPercent(percent)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="dashboard-panel">
                <div className="dashboard-label">
                  Top 5 parfums
                  <span
                    className="info-pill"
                    data-tooltip="Parfums les plus recommandés par /submit."
                    aria-label="Parfums les plus recommandés par /submit."
                  >
                    i
                  </span>
                </div>
                {(metrics.topPerfumes || []).length === 0 ? (
                  <div className="dashboard-empty">Aucune reco pour l’instant.</div>
                ) : (
                  <ul className="stat-list">
                    {(metrics.topPerfumes || []).slice(0, 5).map((item) => (
                      <li className="stat-item" key={item?.name || "perfume"}>
                        <span>{item?.name || "—"}</span>
                        <span className="stat-value">{item?.count ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {(metrics.decisionTime || metrics.decision_time) && (
                <div className="dashboard-panel">
                  <div className="dashboard-label">
                    Temps de décision
                    <span
                      className="info-pill"
                      data-tooltip="Temps entre le début du quiz et la validation."
                      aria-label="Temps entre le début du quiz et la validation."
                    >
                      i
                    </span>
                  </div>
                  {toEntries(metrics.decisionTime || metrics.decision_time).length === 0 ? (
                    <div className="dashboard-empty">Aucune donnée pour l’instant.</div>
                  ) : (
                    <ul className="stat-list">
                      {toEntries(metrics.decisionTime || metrics.decision_time).map((item) => (
                        <li className="stat-item" key={item.label}>
                          <span>{item.label}</span>
                          <span className="stat-value">{formatDurationMs(item.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {metrics.profileUnivers && (
                <div className="dashboard-panel">
                  <div className="dashboard-label">
                    Profils olfactifs
                    <span
                      className="info-pill"
                      data-tooltip="Répartition des profils olfactifs associés aux recommandations."
                      aria-label="Répartition des profils olfactifs associés aux recommandations."
                    >
                      i
                    </span>
                  </div>
                  {toEntries(metrics.profileUnivers).length === 0 ? (
                    <div className="dashboard-empty">Aucune donnée pour l’instant.</div>
                  ) : (
                    <ul className="stat-list">
                      {toEntries(metrics.profileUnivers).map((item) => (
                        <li className="stat-item" key={item.label}>
                          <span>{item.label}</span>
                          <span className="stat-value">{formatValue(item.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {metrics.families && (
                <div className="dashboard-panel">
                  <div className="dashboard-label">
                    Familles
                    <span
                      className="info-pill"
                      data-tooltip="Répartition des familles de parfums recommandées."
                      aria-label="Répartition des familles de parfums recommandées."
                    >
                      i
                    </span>
                  </div>
                  {toEntries(metrics.families).length === 0 ? (
                    <div className="dashboard-empty">Aucune donnée pour l’instant.</div>
                  ) : (
                    <ul className="stat-list">
                      {toEntries(metrics.families).map((item) => (
                        <li className="stat-item" key={item.label}>
                          <span>{item.label}</span>
                          <span className="stat-value">{formatValue(item.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {metrics.variants && (
                <div className="dashboard-panel">
                  <div className="dashboard-label">
                    Variants
                    <span
                      className="info-pill"
                      data-tooltip="Comparaison des métriques par variante."
                      aria-label="Comparaison des métriques par variante."
                    >
                      i
                    </span>
                  </div>
                  <ul className="stat-list">
                    {toEntries(metrics.variants).map((item) => (
                      <li className="stat-item" key={item.label}>
                        <span>{item.label}</span>
                        <span className="stat-value">{formatValue(item.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default DashboardPage;
