import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  QuizEditorAnswer as Answer,
  AnswerCreateInput,
  AnswerUpdateInput,
  QuizEditorQuestion as Question,
  QuizEditorDraftResponse,
  QuestionType,
  QuestionUpdateInput,
  ReorderPayload,
  Quiz,
} from "@poapo/types";
import { ApiError, getToken } from "../lib/api";
import { parseQuizTheme } from "@poapo/types";
import { QuizSelector, useQuiz } from "../contexts/QuizContext";
import { useQuizEditorDraft, type QuizEditorSession } from "../hooks/useQuizEditorDraft";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import QuizDraftStatus from "../components/QuizDraftStatus";

// ─── Types locaux ─────────────────────────────────────────────────────────────

interface QuestionWithAnswers extends Question {
  answers: Answer[];
}

const AXIS_COLORS = ["#0ea5e9", "#f97316", "#ec4899", "#16a34a", "#8b5cf6", "#92400e", "#2563eb", "#ca8a04"];

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "single", label: "Choix unique" },
  { value: "multi", label: "Choix multiple" },
  { value: "scale", label: "Échelle" },
];

const AB_VARIANTS = ["A", "B", "C"];

// ─── Composant Answer Row ─────────────────────────────────────────────────────

function AnswerRow({
  answer,
  impactLabels,
  allQuestionsAnswers,
  onSave,
  onDelete,
  dragHandleProps,
  onPendingChange,
  reorderControls,
}: {
  answer: Answer;
  impactLabels: { key: string; label: string; color: string }[];
  allQuestionsAnswers: { questionId: string; questionText: string; answers: Answer[] }[];
  onSave: (id: string, data: AnswerUpdateInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
  onPendingChange: (key: string, pending: boolean) => void;
  reorderControls?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    text: answer.text,
    emoji: answer.emoji ?? "",
    impacts: { ...answer.impacts },
    active: answer.active,
  });
  useEffect(() => {
    const key = `answer:${answer.id}`;
    const original = { text: answer.text, emoji: answer.emoji ?? "", impacts: answer.impacts, active: answer.active };
    onPendingChange(key, editing && JSON.stringify(fields) !== JSON.stringify(original));
    return () => onPendingChange(key, false);
  }, [answer, fields, editing, onPendingChange]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(answer.id, {
        text: fields.text,
        emoji: fields.emoji || null,
        active: fields.active,
        impacts: fields.impacts,
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
          {impactLabels.map(({ key, label, color }) => (
            <span key={key} className="impact-chip" style={{ "--chip-color": color } as React.CSSProperties}>
              {label[0]} {(answer.impacts[key] ?? 0) > 0 ? "+" : ""}
              {(answer.impacts[key] ?? 0).toFixed(2)}
            </span>
          ))}
        </span>
        <div className="answer-actions">
          {reorderControls}
          <button type="button" className="btn-icon" title="Modifier" onClick={() => {
            setFields({ text: answer.text, emoji: answer.emoji ?? "", impacts: { ...answer.impacts }, active: answer.active });
            setEditing(true);
          }}>
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
        {impactLabels.length === 0 && (
          <p className="field-hint">Aucun axe de recommandation : définissez-en dans la configuration du quiz pour pondérer les réponses.</p>
        )}
        {impactLabels.map(({ key, label, color }) => (
          <div key={key} className="impact-slider-row">
            <label style={{ color, minWidth: 80 }}>{label}</label>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={fields.impacts[key] ?? 0}
              onChange={(e) => setFields((f) => ({ ...f, impacts: { ...f.impacts, [key]: parseFloat(e.target.value) } }))}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{ flex: 1, accentColor: color }}
            />
            <input
              type="number"
              min="-1"
              max="1"
              step="0.01"
              value={(fields.impacts[key] ?? 0).toFixed(2)}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                const safe = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
                setFields((f) => ({ ...f, impacts: { ...f.impacts, [key]: safe } }));
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="input-sm"
              style={{ width: 84 }}
            />
            <span className="impact-value" style={{ color }}>
              {(fields.impacts[key] ?? 0) > 0 ? "+" : ""}
              {(fields.impacts[key] ?? 0).toFixed(2)}
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
  impactLabels,
  allQuestionsAnswers,
  onUpdateQuestion,
  onDeleteQuestion,
  onAddAnswer,
  onUpdateAnswer,
  onDeleteAnswer,
  onReorderAnswers,
  dragHandleProps,
  onPendingChange,
  reorderControls,
  showReorderControls = false,
}: {
  question: QuestionWithAnswers;
  impactLabels: { key: string; label: string; color: string }[];
  allQuestionsAnswers: { questionId: string; questionText: string; answers: Answer[] }[];
  onUpdateQuestion: (id: string, data: QuestionUpdateInput) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onAddAnswer: (questionId: string, data: AnswerCreateInput) => Promise<void>;
  onUpdateAnswer: (id: string, data: AnswerUpdateInput) => Promise<void>;
  onDeleteAnswer: (questionId: string, id: string) => Promise<void>;
  onReorderAnswers: (questionId: string, payload: ReorderPayload) => Promise<void>;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
  onPendingChange: (key: string, pending: boolean) => void;
  reorderControls?: ReactNode;
  showReorderControls?: boolean;
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
  useEffect(() => {
    const key = `question:${question.id}`;
    const original = {
      text: question.text, helpText: question.helpText ?? "", type: question.type,
      conditionAnswerId: question.conditionAnswerId ?? "", abVariant: question.abVariant ?? "", active: question.active,
    };
    onPendingChange(key, (editingMeta && JSON.stringify(meta) !== JSON.stringify(original)) ||
      (addingAnswer && !!(newAnswerText || newAnswerEmoji)));
    return () => onPendingChange(key, false);
  }, [question, meta, editingMeta, addingAnswer, newAnswerText, newAnswerEmoji, onPendingChange]);

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
        {reorderControls}

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
          <button type="button" className="btn-ghost btn-sm" onClick={() => {
            setMeta({
              text: question.text, helpText: question.helpText ?? "", type: question.type,
              conditionAnswerId: question.conditionAnswerId ?? "", abVariant: question.abVariant ?? "", active: question.active,
            });
            setEditingMeta(true);
          }}>
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
          {question.answers.map((answer, index) => (
            <div key={answer.id} onDragOver={(e) => e.preventDefault()} onDrop={() => handleAnswerDrop(answer.id)}>
              <AnswerRow
                answer={answer}
                impactLabels={impactLabels}
                allQuestionsAnswers={allQuestionsAnswers}
                onSave={onUpdateAnswer}
                onDelete={(id) => onDeleteAnswer(question.id, id)}
                dragHandleProps={{
                  draggable: true,
                  onDragStart: () => handleAnswerDragStart(answer.id),
                  onMouseDown: (e) => e.stopPropagation(),
                  onTouchStart: (e) => e.stopPropagation(),
                }}
                onPendingChange={onPendingChange}
                reorderControls={showReorderControls && <span className="editor-reorder-controls">
                  <button type="button" className="btn-icon" aria-label="Monter la réponse" disabled={index === 0}
                    onClick={() => { handleAnswerDragStart(answer.id); void handleAnswerDrop(question.answers[index - 1].id); }}>↑</button>
                  <button type="button" className="btn-icon" aria-label="Descendre la réponse" disabled={index === question.answers.length - 1}
                    onClick={() => { handleAnswerDragStart(answer.id); void handleAnswerDrop(question.answers[index + 1].id); }}>↓</button>
                </span>}
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

export default function QuizBuilderPage() {
  const { quiz, loading, error } = useQuiz();
  if (loading) return <div className="loading-block">Chargement des quiz...</div>;
  return <>
    <QuizSelector />
    {error && <div className="form-error">{error}</div>}
    {quiz && <QuizBuilderContent key={quiz.id} quiz={quiz} />}
  </>;
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function QuizBuilderContent({ quiz, embedded = false, visible = true, renderAppearance, renderPreview, renderPublication }: {
  quiz: Quiz;
  embedded?: boolean;
  visible?: boolean;
  renderAppearance?: (editor: QuizEditorSession, disabled: boolean, themeError: string) => ReactNode;
  renderPreview?: (editor: QuizEditorSession, pending: boolean) => ReactNode;
  renderPublication?: (editor: QuizEditorSession, pending: boolean, onBusyChange: (busy: boolean) => void) => ReactNode;
}) {
  const editor = useQuizEditorDraft(quiz.id);
  const questions = editor.draft?.questions ?? [];
  const { loading } = editor;
  const [publicationBusy, setPublicationBusy] = useState(false);
  const saving = editor.saving || publicationBusy;
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const onPendingChange = useCallback((key: string, value: boolean) => {
    setPending((previous) => previous[key] === value ? previous : { ...previous, [key]: value });
  }, []);
  const setQuestions = (update: (questions: QuestionWithAnswers[]) => QuestionWithAnswers[]) => {
    if (loading || saving || importing) return;
    editor.setDraft((current) => current ? { ...current, questions: update(current.questions) } : current);
  };
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>("");
  const impactLabels = (editor.draft?.config.axes ?? quiz.axes).map((axis, index) => ({
    key: axis.key,
    label: axis.label,
    color: AXIS_COLORS[index % AXIS_COLORS.length],
  }));

  // New question form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState<{ text: string; helpText: string; type: QuestionType }>({
    text: "",
    helpText: "",
    type: "single",
  });
  const hasPending = Object.values(pending).some(Boolean) || (showNewForm && !!(newQuestion.text || newQuestion.helpText));
  const unsaved = editor.dirty || hasPending;
  let themeError = "";
  try { parseQuizTheme(editor.draft?.theme); }
  catch (err) { themeError = err instanceof Error ? err.message : "Thème invalide"; }
  useLeaveGuard(unsaved, "Des modifications locales ne sont pas enregistrées dans le brouillon. Quitter sans les enregistrer ?");

  // Drag state for questions
  const dragQuestionRef = useRef<string | null>(null);

  // Stats A/B
  const variantStats = questions.reduce<Record<string, number>>((acc, q) => {
    const v = q.abVariant ?? "Toutes";
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

  const handleImportCsv = async () => {
    if (!importFile || !editor.state || unsaved) return;
    setImporting(true);
    setImportResult("");
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("revision", String(editor.state.revision));

      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
      const res = await fetch(`${baseUrl}/api/quiz/builder/questions/import-csv?quizId=${encodeURIComponent(quiz.id)}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });

      const body = await res.json() as QuizEditorDraftResponse & {
        createdQuestions: number; createdAnswers: number; skippedRows: number; totalRows: number; error?: string;
      };
      if (!res.ok) {
        throw new ApiError(res.status, body.error ?? `Erreur ${res.status}`);
      }
      editor.accept(body);
      setImportResult(
        `Import termine: ${body.createdQuestions ?? 0} question(s), ${body.createdAnswers ?? 0} reponse(s), ${body.skippedRows ?? 0} ligne(s) ignoree(s) sur ${body.totalRows ?? 0}.`,
      );
      setImportFile(null);
    } catch (err) {
      editor.fail(err);
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
    const created: QuestionWithAnswers = {
      id: `draft_${crypto.randomUUID()}`, text: newQuestion.text.trim(),
      helpText: newQuestion.helpText || null, type: newQuestion.type, imageUrl: null,
      conditionAnswerId: null, abVariant: null, active: true,
      order: Math.max(-1, ...questions.map((q) => q.order)) + 1, answers: [],
    };
    setQuestions((prev) => [...prev, created]);
    setNewQuestion({ text: "", helpText: "", type: "single" });
    setShowNewForm(false);
  };

  const handleUpdateQuestion = async (id: string, data: QuestionUpdateInput) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...data } : q)));
  };

  const handleDeleteQuestion = async (id: string) => {
    const q = questions.find((q) => q.id === id);
    const removedIds = new Set(q?.answers.map((a) => a.id));
    const dependent = questions.some((item) => item.conditionAnswerId && removedIds.has(item.conditionAnswerId));
    if (!confirm(`Supprimer la question « ${q?.text ?? id} » et toutes ses réponses ?${dependent ? " Les questions qui en dépendent deviendront inconditionnelles dans le brouillon." : ""}`)) return;
    setQuestions((prev) => prev.filter((q) => q.id !== id).map((q) =>
      q.conditionAnswerId && removedIds.has(q.conditionAnswerId) ? { ...q, conditionAnswerId: null } : q));
  };

  // ── CRUD Answers ────────────────────────────────────────────────────────────

  const handleAddAnswer = async (questionId: string, data: AnswerCreateInput) => {
    const question = questions.find((q) => q.id === questionId);
    if (!question) throw new Error("Question absente du brouillon");
    const answer: Answer = {
      id: `draft_${crypto.randomUUID()}`, text: data.text, emoji: data.emoji ?? null,
      imageUrl: data.imageUrl ?? null, active: true, impacts: {},
      order: Math.max(-1, ...question.answers.map((a) => a.order)) + 1,
    };
    setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, answers: [...q.answers, answer] } : q)));
  };

  const handleUpdateAnswer = async (id: string, data: AnswerUpdateInput) => {
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        answers: q.answers.map((a) => (a.id === id ? { ...a, ...data, impacts: data.impacts ? Object.fromEntries(
          Object.entries(data.impacts).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
        ) : a.impacts } : a)),
      })),
    );
  };

  const handleDeleteAnswer = async (questionId: string, id: string) => {
    const dependent = questions.some((q) => q.conditionAnswerId === id);
    if (!confirm(`Supprimer cette réponse ?${dependent ? " Les questions qui en dépendent deviendront inconditionnelles dans le brouillon." : ""}`)) return;
    setQuestions((prev) => prev.map((q) => ({
      ...q, answers: q.id === questionId ? q.answers.filter((a) => a.id !== id) : q.answers,
      conditionAnswerId: q.conditionAnswerId === id ? null : q.conditionAnswerId,
    })));
  };

  // ── Reorder ─────────────────────────────────────────────────────────────────

  const handleReorderAnswers = async (questionId: string, payload: ReorderPayload) => {
    const orderedIds = payload.order.map((o) => o.id);
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId) return q;
        const reordered = orderedIds.flatMap((id, order) => {
          const answer = q.answers.find((a) => a.id === id);
          return answer ? [{ ...answer, order }] : [];
        });
        return { ...q, answers: reordered };
      }),
    );
  };

  const handleQuestionDragStart = (id: string) => {
    dragQuestionRef.current = id;
  };

  const handleQuestionDrop = async (targetId: string) => {
    if (saving || importing) return;
    const dragId = dragQuestionRef.current;
    if (!dragId || dragId === targetId) return;

    const fromIdx = questions.findIndex((q) => q.id === dragId);
    const toIdx = questions.findIndex((q) => q.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...questions];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    setQuestions(() => reordered.map((q, order) => ({ ...q, order })));
    dragQuestionRef.current = null;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="page">
      <QuizDraftStatus dirty={unsaved} hasChanges={editor.state?.hasChanges ?? false}
        revision={editor.state?.revision ?? 0} saving={saving || importing || loading} conflict={editor.conflict} error={editor.error}
        onReload={() => {
          if (!unsaved || confirm("Recharger et perdre les modifications locales non enregistrées ?")) void editor.load();
        }}
        onDiscard={() => {
          if (confirm("Abandonner toutes les modifications préparatoires de ce quiz ? Le contenu public restera inchangé.")) {
            void editor.discard().then((ok) => { if (ok) { setShowNewForm(false); setPending({}); } });
          }
        }} />
      {hasPending && <p role="status">Terminez ou annulez les formulaires ouverts avant d'enregistrer le brouillon.</p>}
      {themeError && <p id="theme-validation-error" className="form-error" role="alert">{themeError}</p>}
      <button type="button" className="btn-primary"
        disabled={loading || saving || importing || !editor.draft || !editor.dirty || hasPending || editor.conflict || !!themeError}
        onClick={() => void editor.save()}>Enregistrer le brouillon</button>
      <div hidden={!visible} className="quiz-editor-panel"
        {...(embedded ? { role: "tabpanel", id: "editor-panel-questions", "aria-labelledby": "editor-tab-questions" } : {})}>
      <fieldset disabled={loading || saving || importing || !editor.draft} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          {embedded ? <h2 className="page-title">Questions et réponses</h2> :
            <h1 className="page-title">Quiz Builder — {quiz.name}</h1>}
          <p className="page-subtitle">
            {questions.length} question{questions.length !== 1 ? "s" : ""} · {questions.filter((q) => q.active).length} active
            {questions.filter((q) => q.active).length !== 1 ? "s" : ""}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowNewForm(true)}>
          + Nouvelle question
        </button>
      </div>
      <p className="section-hint">Les boutons des cartes appliquent les changements localement. Enregistrez ensuite le brouillon complet.</p>

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
        <p className="section-hint">L'import ajoute les questions au brouillon, jamais au quiz public. Enregistrez d'abord les changements locaux.</p>
        <div className="form-row">
          <label className="form-label">Fichier CSV</label>
          <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className="page-subtitle" style={{ marginTop: "0.25rem" }}>
          Colonnes requises: question, answer. Optionnelles: helpText, type, questionActive, abVariant, emoji, answerActive
          {impactLabels.length > 0 && <>, et une colonne d'impact (-1 à 1) par axe : {impactLabels.map((axis) => axis.key).join(", ")}</>}.
        </p>
        <div className="new-question-actions">
          <button type="button" className="btn-primary" onClick={() => void handleImportCsv()} disabled={!importFile || importing || unsaved || editor.conflict}>
            {importing ? "Import en cours..." : "Importer le CSV"}
          </button>
        </div>
        {importResult && <p className={importResult.startsWith("Erreur") ? "error-msg" : "text-muted"}>{importResult}</p>}
      </div>

      {loading && <p className="text-muted">Chargement…</p>}

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
        {questions.map((question, index) => (
          <div id={`editor-question-${question.id}`} key={`${editor.state?.revision}:${question.id}`} onDragOver={(e) => e.preventDefault()} onDrop={() => handleQuestionDrop(question.id)}>
            <QuestionCard
              question={question}
              impactLabels={impactLabels}
              allQuestionsAnswers={allQuestionsAnswers}
              onUpdateQuestion={handleUpdateQuestion}
              onDeleteQuestion={handleDeleteQuestion}
              onAddAnswer={handleAddAnswer}
              onUpdateAnswer={handleUpdateAnswer}
              onDeleteAnswer={handleDeleteAnswer}
              onReorderAnswers={handleReorderAnswers}
              onPendingChange={onPendingChange}
              showReorderControls={embedded}
              reorderControls={embedded && <span className="editor-reorder-controls">
                <button type="button" className="btn-icon" aria-label="Monter la question" disabled={index === 0}
                  onClick={() => { handleQuestionDragStart(question.id); handleQuestionDrop(questions[index - 1].id); }}>↑</button>
                <button type="button" className="btn-icon" aria-label="Descendre la question" disabled={index === questions.length - 1}
                  onClick={() => { handleQuestionDragStart(question.id); handleQuestionDrop(questions[index + 1].id); }}>↓</button>
              </span>}
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
      </fieldset>
      </div>
      {renderAppearance?.(editor, loading || saving || importing || !editor.draft, themeError)}
      {renderPreview?.(editor, hasPending)}
      {renderPublication?.(editor, hasPending, setPublicationBusy)}
    </div>
  );
}
