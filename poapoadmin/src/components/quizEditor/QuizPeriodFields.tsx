import { useEffect, useRef, useState } from "react";
import type { CampaignOccasion, Quiz } from "@poapo/types";
import { apiFetch } from "../../lib/api";
import { fromDateInput, OCCASION_LABELS, OCCASIONS, toDateInput } from "../../lib/occasions";

/** Occasion et période (facultatives) : enregistrées automatiquement, sans effet sur ce que voient les visiteurs. */
export default function QuizPeriodFields({ quiz }: { quiz: Quiz }) {
  const [occasion, setOccasion] = useState<CampaignOccasion | "">(quiz.occasion ?? "");
  const [label, setLabel] = useState(quiz.occasionLabel ?? "");
  const [start, setStart] = useState(toDateInput(quiz.startsAt));
  const [end, setEnd] = useState(toDateInput(quiz.endsAt));
  const [status, setStatus] = useState<"" | "saving" | "saved">("");
  const [error, setError] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStatus(""); setError("");
    if (occasion === "CUSTOM" && !label.trim()) return;
    if (start && end && end < start) { setError("La date de fin doit être après la date de début."); return; }
    const timer = window.setTimeout(async () => {
      setStatus("saving");
      try {
        await apiFetch(`/api/quizzes/${encodeURIComponent(quiz.id)}`, {
          method: "PUT",
          body: JSON.stringify({ occasion: occasion || null, occasionLabel: occasion === "CUSTOM" ? label.trim() : null, startsAt: fromDateInput(start), endsAt: fromDateInput(end, true) }),
        });
        setStatus("saved");
      } catch (err) { setStatus(""); setError(err instanceof Error ? err.message : "Enregistrement impossible"); }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [occasion, label, start, end, quiz.id]);

  return <section className="form-section">
    <h2 className="section-title">Occasion et période (facultatif)</h2>
    <p className="section-hint">Pour vous repérer, par exemple « Noël, du 1er au 24 décembre ». Cela n'ouvre ni ne ferme l'expérience : elle reste visible tant qu'elle est publiée.</p>
    <div className="form-grid">
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-occasion">Occasion</label>
        <select id="quiz-occasion" className="field-select" value={occasion} onChange={(e) => setOccasion(e.target.value as CampaignOccasion | "")}>
          <option value="">Aucune</option>
          {OCCASIONS.map((value) => <option key={value} value={value}>{OCCASION_LABELS[value]}</option>)}
        </select>
      </div>
      {occasion === "CUSTOM" && <div className="field-group">
        <label className="field-label" htmlFor="quiz-occasion-label">Nom de l'occasion</label>
        <input id="quiz-occasion-label" className="field-input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>}
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-starts">Début</label>
        <input id="quiz-starts" type="date" className="field-input" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-ends">Fin</label>
        <input id="quiz-ends" type="date" className="field-input" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {status && <p className="section-hint" role="status">{status === "saving" ? "Enregistrement…" : "Enregistré ✓"}</p>}
  </section>;
}
