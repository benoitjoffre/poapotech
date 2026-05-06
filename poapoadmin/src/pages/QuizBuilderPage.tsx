import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Answer,
  AnswerCreateInput,
  AnswerUpdateInput,
  Question,
  QuestionCreateInput,
  QuestionType,
  QuestionUpdateInput,
  ReorderPayload,
} from "@poapo/types";
import { apiFetch, getToken } from "../lib/api";

// ─── Types locaux ─────────────────────────────────────────────────────────────

interface QuestionWithAnswers extends Question {
  answers: Answer[];
}

const IMPACT_LABELS: { key: keyof Answer["impacts"]; label: string; color: string }[] = [
  { key: "freshness", label: "Fraîcheur", color: "#0ea5e9" },
  { key: "intensity", label: "Intensité", color: "#f97316" },
  { key: "sweetness", label: "Douceur", color: "#ec4899" },
];

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "single", label: "Choix unique" },
  { value: "multi", label: "Choix multiple" },
  { value: "scale", label: "Échelle" },
];

const AB_VARIANTS = ["A", "B", "C"];

// ─── Composant Answer Row ─────────────────────────────────────────────────────

function AnswerRow({
  answer,
  allQuestionsAnswers,
  onSave,
  onDelete,
  dragHandleProps,
}: {
  answer: Answer;
  allQuestionsAnswers: { questionId: string; questionText: string; answers: Answer[] }[];
  onSave: (id: string, data: AnswerUpdateInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    text: answer.text,
    emoji: answer.emoji ?? "",
    freshness: answer.impacts.freshness,
    intensity: answer.impacts.intensity,
    sweetness: answer.impacts.sweetness,
    active: answer.active,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(answer.id, {
        text: fields.text,
        emoji: fields.emoji || null,
        active: fields.active,
        impacts: {
          freshness: fields.freshness,
          intensity: fields.intensity,
          sweetness: fields.sweetness,
        },
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  // allQuestionsAnswers is passed but not used in Answer row — it's used at question level for conditions
  void allQuestionsAnswers;

  if (!editing) {
    return (
      <div className={`answer-row${answer.active ? "" : " answer-row--inactive"}`}>
        <span className="drag-handle" {...dragHandleProps}>
          ⠿
        </span>
        <span className="answer-emoji">{answer.emoji || "·"}</span>
        <span className="answer-text">{answer.text}</span>
        <span className="answer-impacts">
          {IMPACT_LABELS.map(({ key, label, color }) => (
            <span key={key} className="impact-chip" style={{ "--chip-color": color } as React.CSSProperties}>
              {label[0]} {answer.impacts[key] > 0 ? "+" : ""}
              {answer.impacts[key].toFixed(2)}
            </span>
          ))}
        </span>
        <div className="answer-actions">
          <button type="button" className="btn-icon" title="Modifier" onClick={() => setEditing(true)}>
            ✏️
          </button>
          <button type="button" className="btn-icon btn-icon--danger" title="Supprimer" onClick={() => onDelete(answer.id)}>
            🗑
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="answer-edit-form">
      <div className="answer-edit-row">
        <input
          className="input-sm"
          placeholder="Emoji"
          value={fields.emoji}
          onChange={(e) => setFields((f) => ({ ...f, emoji: e.target.value }))}
          style={{ width: 60 }}
        />
        <input
          className="input-sm"
          placeholder="Texte de la réponse"
          value={fields.text}
          onChange={(e) => setFields((f) => ({ ...f, text: e.target.value }))}
          style={{ flex: 1 }}
        />
        <label className="toggle-label">
          <input type="checkbox" checked={fields.active} onChange={(e) => setFields((f) => ({ ...f, active: e.target.checked }))} /> Active
        </label>
      </div>
      <div className="impact-sliders">
        {IMPACT_LABELS.map(({ key, label, color }) => (
          <div key={key} className="impact-slider-row">
            <label style={{ color, minWidth: 80 }}>{label}</label>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={fields[key]}
              onChange={(e) => setFields((f) => ({ ...f, [key]: parseFloat(e.target.value) }))}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{ flex: 1, accentColor: color }}
            />
            <input
              type="number"
              min="-1"
              max="1"
              step="0.01"
              value={fields[key].toFixed(2)}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                const safe = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
                setFields((f) => ({ ...f, [key]: safe }));
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="input-sm"
              style={{ width: 84 }}
            />
            <span className="impact-value" style={{ color }}>
              {fields[key] > 0 ? "+" : ""}
              {fields[key].toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div className="answer-edit-actions">
        <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
          Annuler
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ─── Composant Question Card ──────────────────────────────────────────────────

function QuestionCard({
  question,
  allQuestionsAnswers,
  onUpdateQuestion,
  onDeleteQuestion,
  onAddAnswer,
  onUpdateAnswer,
  onDeleteAnswer,
  onReorderAnswers,
  dragHandleProps,
}: {
  question: QuestionWithAnswers;
  allQuestionsAnswers: { questionId: string; questionText: string; answers: Answer[] }[];
  onUpdateQuestion: (id: string, data: QuestionUpdateInput) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onAddAnswer: (questionId: string, data: AnswerCreateInput) => Promise<void>;
  onUpdateAnswer: (id: string, data: AnswerUpdateInput) => Promise<void>;
  onDeleteAnswer: (questionId: string, id: string) => Promise<void>;
  onReorderAnswers: (questionId: string, payload: ReorderPayload) => Promise<void>;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingMeta, setEditingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingAnswer, setAddingAnswer] = useState(false);
  const [newAnswerText, setNewAnswerText] = useState("");
  const [newAnswerEmoji, setNewAnswerEmoji] = useState("");
  const [meta, setMeta] = useState({
    text: question.text,
    helpText: question.helpText ?? "",
    type: question.type,
    conditionAnswerId: question.conditionAnswerId ?? "",
    abVariant: question.abVariant ?? "",
    active: question.active,
  });

  // Drag state for answers
  const dragAnswerRef = useRef<string | null>(null);

  const handleSaveMeta = async () => {
    setSaving(true);
    try {
      await onUpdateQuestion(question.id, {
        text: meta.text,
        helpText: meta.helpText || null,
        type: meta.type,
        conditionAnswerId: meta.conditionAnswerId || null,
        abVariant: meta.abVariant || null,
        active: meta.active,
      });
      setEditingMeta(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAddAnswer = async () => {
    if (!newAnswerText.trim()) return;
    await onAddAnswer(question.id, { text: newAnswerText.trim(), emoji: newAnswerEmoji || null });
    setNewAnswerText("");
    setNewAnswerEmoji("");
    setAddingAnswer(false);
  };

  const handleAnswerDragStart = (id: string) => {
    dragAnswerRef.current = id;
  };

  const handleAnswerDrop = async (targetId: string) => {
    const dragId = dragAnswerRef.current;
    if (!dragId || dragId === targetId) return;

    const answers = [...question.answers];
    const fromIdx = answers.findIndex((a) => a.id === dragId);
    const toIdx = answers.findIndex((a) => a.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...answers];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    await onReorderAnswers(question.id, {
      order: reordered.map((a, i) => ({ id: a.id, order: i })),
    });
    dragAnswerRef.current = null;
  };

  // Flatten all answers for condition picker (exclude own answers)
  const conditionOptions = allQuestionsAnswers.filter((q) => q.questionId !== question.id);

  return (
    <div className={`question-card${question.active ? "" : " question-card--inactive"}`}>
      {/* Header */}
      <div className="question-card-header">
        <span className="drag-handle question-drag" {...dragHandleProps}>
          ⠿
        </span>
        <span className="question-order">Q{question.order + 1}</span>

        <div className="question-badges">
          <span className="badge badge--type">{question.type}</span>
          {question.abVariant && <span className="badge badge--ab">Var. {question.abVariant}</span>}
          {question.conditionAnswerId && <span className="badge badge--cond">🔀 Conditionnelle</span>}
          {!question.active && <span className="badge badge--inactive">Inactif</span>}
        </div>

        {editingMeta ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingMeta(false)}>
            Annuler
          </button>
        ) : (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingMeta(true)}>
            ✏️ Modifier
          </button>
        )}
        <button type="button" className="btn-icon btn-icon--danger" onClick={() => onDeleteQuestion(question.id)} title="Supprimer la question">
          🗑
        </button>
        <button type="button" className="btn-icon" onClick={() => setExpanded((x) => !x)} title={expanded ? "Réduire" : "Développer"}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Meta edit form */}
      {editingMeta ? (
        <div className="question-meta-form">
          <div className="form-row">
            <label className="form-label">Question *</label>
            <input className="input" value={meta.text} onChange={(e) => setMeta((m) => ({ ...m, text: e.target.value }))} />
          </div>
          <div className="form-row">
            <label className="form-label">Aide (optionnel)</label>
            <input
              className="input"
              placeholder="Ex: Pensez à votre routine du matin…"
              value={meta.helpText}
              onChange={(e) => setMeta((m) => ({ ...m, helpText: e.target.value }))}
            />
          </div>
          <div className="form-row form-row--inline">
            <div>
              <label className="form-label">Type</label>
              <select className="select" value={meta.type} onChange={(e) => setMeta((m) => ({ ...m, type: e.target.value as QuestionType }))}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Variante A/B</label>
              <select className="select" value={meta.abVariant} onChange={(e) => setMeta((m) => ({ ...m, abVariant: e.target.value }))}>
                <option value="">Toutes (aucune)</option>
                {AB_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    Variante {v}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label className="toggle-label">
                <input type="checkbox" checked={meta.active} onChange={(e) => setMeta((m) => ({ ...m, active: e.target.checked }))} /> Active
              </label>
            </div>
          </div>
          {conditionOptions.length > 0 && (
            <div className="form-row">
              <label className="form-label">Afficher seulement si → réponse sélectionnée :</label>
              <select
                className="select"
                value={meta.conditionAnswerId}
                onChange={(e) => setMeta((m) => ({ ...m, conditionAnswerId: e.target.value }))}
              >
                <option value="">— Toujours afficher —</option>
                {conditionOptions.map((q) => (
                  <optgroup key={q.questionId} label={q.questionText}>
                    {q.answers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.emoji ? `${a.emoji} ` : ""}
                        {a.text}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <div className="question-meta-actions">
            <button type="button" className="btn-ghost" onClick={() => setEditingMeta(false)}>
              Annuler
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveMeta} disabled={saving}>
              {saving ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>
      ) : (
        <div className="question-text-display">
          <span className="question-main-text">{question.text}</span>
          {question.helpText && <span className="question-help">{question.helpText}</span>}
        </div>
      )}

      {/* Answers */}
      {expanded && (
        <div className="question-answers">
          {question.answers.map((answer) => (
            <div key={answer.id} onDragOver={(e) => e.preventDefault()} onDrop={() => handleAnswerDrop(answer.id)}>
              <AnswerRow
                answer={answer}
                allQuestionsAnswers={allQuestionsAnswers}
                onSave={onUpdateAnswer}
                onDelete={(id) => onDeleteAnswer(question.id, id)}
                dragHandleProps={{
                  draggable: true,
                  onDragStart: () => handleAnswerDragStart(answer.id),
                  onMouseDown: (e) => e.stopPropagation(),
                  onTouchStart: (e) => e.stopPropagation(),
                }}
              />
            </div>
          ))}

          {/* Add new answer */}
          {addingAnswer ? (
            <div className="add-answer-form">
              <input
                className="input-sm"
                placeholder="Emoji"
                value={newAnswerEmoji}
                onChange={(e) => setNewAnswerEmoji(e.target.value)}
                style={{ width: 60 }}
              />
              <input
                className="input-sm"
                placeholder="Texte de la réponse…"
                value={newAnswerText}
                onChange={(e) => setNewAnswerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddAnswer();
                }}
                style={{ flex: 1 }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              <button type="button" className="btn-primary btn-sm" onClick={handleAddAnswer}>
                + Ajouter
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAddingAnswer(false)}>
                Annuler
              </button>
            </div>
          ) : (
            <button type="button" className="add-answer-btn" onClick={() => setAddingAnswer(true)}>
              + Ajouter une réponse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function QuizBuilderPage() {
  const [questions, setQuestions] = useState<QuestionWithAnswers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTenantEmail, setImportTenantEmail] = useState("demo@poapo-tech.com");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>("");

  // New question form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState<{ text: string; helpText: string; type: QuestionType }>({
    text: "",
    helpText: "",
    type: "single",
  });

  // Drag state for questions
  const dragQuestionRef = useRef<string | null>(null);

  // Stats A/B
  const variantStats = questions.reduce<Record<string, number>>((acc, q) => {
    const v = q.abVariant ?? "Toutes";
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<QuestionWithAnswers[]>("/api/quiz/builder/questions");
      setQuestions(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImportCsv = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult("");
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      if (importTenantEmail.trim()) formData.append("tenantEmail", importTenantEmail.trim());

      const token = getToken();
      const res = await fetch("/api/quiz/builder/questions/import-csv", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });

      let body: { createdQuestions?: number; createdAnswers?: number; skippedRows?: number; totalRows?: number; error?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // ignore parse error and fallback to generic message
      }

      if (!res.ok) {
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }

      setImportResult(
        `Import termine: ${body.createdQuestions ?? 0} question(s), ${body.createdAnswers ?? 0} reponse(s), ${body.skippedRows ?? 0} ligne(s) ignoree(s) sur ${body.totalRows ?? 0}.`,
      );
      setImportFile(null);
      await load();
    } catch (err) {
      setImportResult(`Erreur import: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // Flatten all answers for condition picker
  const allQuestionsAnswers = questions.map((q) => ({
    questionId: q.id,
    questionText: q.text,
    answers: q.answers,
  }));

  // ── CRUD Questions ──────────────────────────────────────────────────────────

  const handleCreateQuestion = async () => {
    if (!newQuestion.text.trim()) return;
    setSaving(true);
    try {
      const created = await apiFetch<QuestionWithAnswers>("/api/quiz/builder/questions", {
        method: "POST",
        body: JSON.stringify({
          text: newQuestion.text.trim(),
          helpText: newQuestion.helpText || null,
          type: newQuestion.type,
        } satisfies QuestionCreateInput),
      });
      setQuestions((prev) => [...prev, created]);
      setNewQuestion({ text: "", helpText: "", type: "single" });
      setShowNewForm(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateQuestion = async (id: string, data: QuestionUpdateInput) => {
    const updated = await apiFetch<QuestionWithAnswers>(`/api/quiz/builder/questions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...updated } : q)));
  };

  const handleDeleteQuestion = async (id: string) => {
    const q = questions.find((q) => q.id === id);
    if (!confirm(`Supprimer la question « ${q?.text ?? id} » et toutes ses réponses ?`)) return;
    await apiFetch(`/api/quiz/builder/questions/${id}`, { method: "DELETE" });
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  // ── CRUD Answers ────────────────────────────────────────────────────────────

  const handleAddAnswer = async (questionId: string, data: AnswerCreateInput) => {
    const answer = await apiFetch<Answer>(`/api/quiz/builder/questions/${questionId}/answers`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, answers: [...q.answers, answer] } : q)));
  };

  const handleUpdateAnswer = async (id: string, data: AnswerUpdateInput) => {
    const updated = await apiFetch<Answer>(`/api/quiz/builder/answers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        answers: q.answers.map((a) => (a.id === id ? updated : a)),
      })),
    );
  };

  const handleDeleteAnswer = async (questionId: string, id: string) => {
    await apiFetch(`/api/quiz/builder/answers/${id}`, { method: "DELETE" });
    setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, answers: q.answers.filter((a) => a.id !== id) } : q)));
  };

  // ── Reorder ─────────────────────────────────────────────────────────────────

  const handleReorderAnswers = async (questionId: string, payload: ReorderPayload) => {
    await apiFetch<{ ok: boolean }>("/api/quiz/builder/answers/reorder-all", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const orderedIds = payload.order.map((o) => o.id);
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId) return q;
        const reordered = orderedIds.map((id) => q.answers.find((a) => a.id === id)).filter(Boolean) as Answer[];
        return { ...q, answers: reordered };
      }),
    );
  };

  const handleQuestionDragStart = (id: string) => {
    dragQuestionRef.current = id;
  };

  const handleQuestionDrop = async (targetId: string) => {
    const dragId = dragQuestionRef.current;
    if (!dragId || dragId === targetId) return;

    const fromIdx = questions.findIndex((q) => q.id === dragId);
    const toIdx = questions.findIndex((q) => q.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...questions];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const payload = {
      order: reordered.map((q, i) => ({ id: q.id, order: i })),
    };

    try {
      await apiFetch<{ ok: boolean }>("/api/quiz/builder/questions/reorder", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      // Update state after successful API call
      const orderedIds = payload.order.map((o) => o.id);
      const reorderedAfter = orderedIds.map((id) => questions.find((q) => q.id === id)).filter(Boolean) as QuestionWithAnswers[];
      setQuestions(reorderedAfter);
    } catch (err) {
      alert((err as Error).message);
      void load(); // revert
    }
    dragQuestionRef.current = null;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Quiz Builder</h1>
          <p className="page-subtitle">
            {questions.length} question{questions.length !== 1 ? "s" : ""} · {questions.filter((q) => q.active).length} active
            {questions.filter((q) => q.active).length !== 1 ? "s" : ""}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowNewForm(true)}>
          + Nouvelle question
        </button>
      </div>

      {/* A/B Stats */}
      {Object.keys(variantStats).length > 1 && (
        <div className="ab-stats-bar">
          <span className="ab-stats-label">A/B :</span>
          {Object.entries(variantStats).map(([variant, count]) => (
            <span key={variant} className="ab-stats-chip">
              {variant === "Toutes" ? "Communes" : `Var. ${variant}`} — {count} question{count !== 1 ? "s" : ""}
            </span>
          ))}
        </div>
      )}

      {/* CSV Import */}
      <div className="new-question-form" style={{ marginBottom: "1rem" }}>
        <h3 className="form-section-title">Import CSV Questions/Reponses</h3>
        <div className="form-row">
          <label className="form-label">Tenant email (utile en super-admin)</label>
          <input
            className="input"
            placeholder="demo@poapo-tech.com"
            value={importTenantEmail}
            onChange={(e) => setImportTenantEmail(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label className="form-label">Fichier CSV</label>
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <p className="page-subtitle" style={{ marginTop: "0.25rem" }}>
          Colonnes requises: question, answer. Optionnelles: helpText, type, questionActive, abVariant, emoji, freshness, intensity, sweetness,
          answerActive.
        </p>
        <div className="new-question-actions">
          <button type="button" className="btn-primary" onClick={() => void handleImportCsv()} disabled={!importFile || importing}>
            {importing ? "Import en cours..." : "Importer le CSV"}
          </button>
        </div>
        {importResult && <p className={importResult.startsWith("Erreur") ? "error-msg" : "text-muted"}>{importResult}</p>}
      </div>

      {loading && <p className="text-muted">Chargement…</p>}
      {error && <p className="error-msg">{error}</p>}

      {/* New question form */}
      {showNewForm && (
        <div className="new-question-form">
          <h3 className="form-section-title">Nouvelle question</h3>
          <div className="form-row">
            <label className="form-label">Question *</label>
            <input
              className="input"
              placeholder="Ex: Quelle est votre saison préférée ?"
              value={newQuestion.text}
              onChange={(e) => setNewQuestion((q) => ({ ...q, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateQuestion();
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <div className="form-row">
            <label className="form-label">Texte d'aide</label>
            <input
              className="input"
              placeholder="Optionnel — affiché sous la question"
              value={newQuestion.helpText}
              onChange={(e) => setNewQuestion((q) => ({ ...q, helpText: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label className="form-label">Type</label>
            <select
              className="select"
              value={newQuestion.type}
              onChange={(e) => setNewQuestion((q) => ({ ...q, type: e.target.value as QuestionType }))}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="new-question-actions">
            <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>
              Annuler
            </button>
            <button type="button" className="btn-primary" onClick={handleCreateQuestion} disabled={saving || !newQuestion.text.trim()}>
              {saving ? "Création…" : "Créer la question"}
            </button>
          </div>
        </div>
      )}

      {/* Questions list */}
      <div className="questions-list">
        {questions.length === 0 && !loading && (
          <div className="empty-state">
            <p>Aucune question pour l'instant.</p>
            <button type="button" className="btn-primary" onClick={() => setShowNewForm(true)}>
              Créer la première question
            </button>
          </div>
        )}
        {questions.map((question) => (
          <div key={question.id} onDragOver={(e) => e.preventDefault()} onDrop={() => handleQuestionDrop(question.id)}>
            <QuestionCard
              question={question}
              allQuestionsAnswers={allQuestionsAnswers}
              onUpdateQuestion={handleUpdateQuestion}
              onDeleteQuestion={handleDeleteQuestion}
              onAddAnswer={handleAddAnswer}
              onUpdateAnswer={handleUpdateAnswer}
              onDeleteAnswer={handleDeleteAnswer}
              onReorderAnswers={handleReorderAnswers}
              dragHandleProps={{
                draggable: true,
                onDragStart: () => handleQuestionDragStart(question.id),
                onMouseDown: (e) => e.stopPropagation(),
                onTouchStart: (e) => e.stopPropagation(),
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
