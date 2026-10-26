import { useState } from "react";
import type { ResultsDailyPoint } from "@poapo/types";
import { METRICS, dayLabel, type MetricKey } from "../../lib/results";

const COLORS: Record<MetricKey, string> = { started: "#6c47ff", completed: "#2563eb", recommendations: "#9b7bff", productClicks: "#0f766e" };
const W = 720;
const H = 220;
const PAD = { left: 40, right: 12, top: 12, bottom: 24 };

/** Courbes quotidiennes en SVG ; une alternative tabulaire est proposée aux lecteurs d'écran. */
export default function ResultsChart({ daily, title }: { daily: ResultsDailyPoint[]; title: string }) {
  const [hidden, setHidden] = useState<Set<MetricKey>>(new Set());
  const visible = METRICS.filter((m) => !hidden.has(m.key));
  const max = Math.max(1, ...daily.flatMap((d) => visible.map((m) => d[m.key])));
  const x = (i: number) => PAD.left + (daily.length <= 1 ? 0 : (i / (daily.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const hasData = daily.some((d) => METRICS.some((m) => d[m.key] > 0));
  const toggle = (key: MetricKey) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const ticks = [0, 0.5, 1].map((r) => Math.round(max * r));
  const labelIdx = daily.length <= 1 ? [0] : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];

  return (
    <div className="rs-chart">
      <ul className="rs-legend" aria-label="Indicateurs affichés">
        {METRICS.map((m) => (
          <li key={m.key}>
            <button type="button" className="rs-legend-btn" aria-pressed={!hidden.has(m.key)} onClick={() => toggle(m.key)}>
              <span className="rs-dot" style={{ background: COLORS[m.key] }} aria-hidden="true" />{m.label}
            </button>
          </li>
        ))}
      </ul>
      {!hasData ? <p className="rs-empty">Aucune donnée enregistrée sur cette période.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} : évolution quotidienne`} className="rs-svg">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e2e7" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{t}</text>
            </g>
          ))}
          {visible.map((m) => (
            <polyline key={m.key} fill="none" stroke={COLORS[m.key]} strokeWidth="2" strokeLinejoin="round"
              points={daily.map((d, i) => `${x(i)},${y(d[m.key])}`).join(" ")} />
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="#6b7280" textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"}>
              {dayLabel(daily[i].date)}
            </text>
          ))}
        </svg>
      )}
      {hasData && (
        <details className="rs-table-alt">
          <summary>Voir les valeurs jour par jour</summary>
          <div className="rs-table-wrap">
            <table className="table">
              <caption className="sr-only">{title} : valeurs quotidiennes</caption>
              <thead><tr><th scope="col">Jour</th>{METRICS.map((m) => <th key={m.key} scope="col">{m.label}</th>)}</tr></thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}><th scope="row">{dayLabel(d.date)}</th>{METRICS.map((m) => <td key={m.key}>{d[m.key]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
