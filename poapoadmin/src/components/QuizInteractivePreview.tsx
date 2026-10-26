import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveQuizTheme, type QuizPreviewSnapshot, type QuizResult } from "@poapo/types";
import { QuizContent, type QuizPreviewRuntime } from "../../../poapofront/src/pages/QuizPage";
import QuizThemeStyle from "../../../poapofront/src/components/QuizThemeStyle";
import baseStyles from "../../../poapofront/src/index.css?inline";
import widgetStyles from "../../../poapofront/src/App.css?inline";
import type { QuizEditorSession } from "../hooks/useQuizEditorDraft";
import { apiFetch } from "../lib/api";

function PreviewFrame({ snapshot, variant, run, mobile }: {
  snapshot: QuizPreviewSnapshot; variant: string | null; run: number; mobile: boolean;
}) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const runtime = useMemo<QuizPreviewRuntime>(() => {
    const { draft, quizId, branding } = snapshot;
    const theme = resolveQuizTheme(branding, draft.theme);
    return {
      quizId, abVariant: variant, theme,
      config: {
        tenantId: "", quizId, industry: draft.config.industry, axes: draft.config.axes,
        primaryColor: theme.primaryColor, logoUrl: theme.logoUrl, tenantName: branding.name,
        quizTitle: draft.config.quizTitle, ctaText: draft.config.ctaText, active: draft.config.active,
      },
      questions: [...draft.questions].sort((a, b) => a.order - b.order)
        .filter((q) => q.active).map((q) => ({
          ...q, tenantId: "", quizId,
          answers: [...q.answers].sort((a, b) => a.order - b.order)
            .filter((a) => a.active).map((a) => ({ ...a, questionId: q.id })),
        })),
      submit: (answers, abVariant) => apiFetch<QuizResult>(
        `/api/quizzes/${encodeURIComponent(quizId)}/preview/recommendations`,
        { method: "POST", body: JSON.stringify({ draft, answers, abVariant }) },
      ),
    };
  }, [snapshot, variant]);
  const theme = runtime.theme;
  const overrides = `
    :root { color-scheme: light; --primary-color: ${theme.primaryColor}; }
    body { display: block; min-width: 0; background: ${theme.background}; }
    #root { box-sizing: border-box; width: 100%; }
    .intro-logo img { max-width: 100%; object-fit: contain; }
    .intro-layout { grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
    .hero-actions::before { left: 0; right: 0; }
  `;
  return <iframe title="Parcours du quiz en mode aperçu" className={`quiz-preview-frame${mobile ? " mobile" : ""}`}
    onLoad={(event) => setMount(event.currentTarget.contentDocument?.getElementById("root") ?? null)}
    srcDoc={'<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'}>
    {mount && createPortal(<>
      <style>{baseStyles + widgetStyles + overrides}</style>
      <QuizThemeStyle branding={snapshot.branding} theme={snapshot.draft.theme} />
      <QuizContent key={`${variant}:${run}`} preview={runtime} />
    </>, mount)}
  </iframe>;
}

export default function QuizInteractivePreview({ editor, quizId, visible, pending }: {
  editor: QuizEditorSession; quizId: string; visible: boolean; pending: boolean;
}) {
  const [snapshot, setSnapshot] = useState<QuizPreviewSnapshot | null>(null);
  const [source, setSource] = useState("");
  const [variant, setVariant] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [run, setRun] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const local = JSON.stringify(editor.draft);
  const stale = !!snapshot && source !== local;
  async function launch() {
    if (!editor.draft || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const next = await apiFetch<QuizPreviewSnapshot>(`/api/quizzes/${encodeURIComponent(quizId)}/preview`, {
        method: "POST", body: JSON.stringify({ draft: editor.draft }),
      });
      setSnapshot(next);
      setSource(local);
      setVariant(next.draft.questions.find((q) => q.active && q.abVariant)?.abVariant ?? null);
      setRun((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de préparer l'aperçu");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  const variants = [...new Set(snapshot?.draft.questions.filter((q) => q.active).map((q) => q.abVariant).filter((v): v is string => !!v))];
  return <section id="editor-panel-preview" role="tabpanel" aria-labelledby="editor-tab-preview"
    hidden={!visible} className="quiz-editor-panel quiz-interactive-preview">
    <div className="quiz-preview-notice">
      <strong>Mode aperçu — aucune donnée enregistrée</strong>
      <p>L'aperçu utilise un instantané de l'état local, y compris les modifications non enregistrées.
        Il ne sauvegarde ni brouillon, ni session, ni statistique. Les liens d'achat sont désactivés.</p>
    </div>
    {pending && <p className="quiz-editor-shared" role="status">Un formulaire de question ou réponse est en cours :
      validez-le dans Questions pour inclure son contenu dans le prochain aperçu. Il reste conservé entre les onglets.</p>}
    {stale && <p role="status">Le brouillon local a changé. Relancez l'aperçu pour actualiser son contenu.</p>}
    <div className="quiz-preview-toolbar">
      <button type="button" className="btn-primary" disabled={loading || editor.loading || !editor.draft} onClick={() => void launch()}>
        {loading ? "Préparation…" : snapshot ? "Actualiser depuis l'état local" : "Lancer l'aperçu local"}
      </button>
      <button type="button" className="btn-ghost" aria-pressed={!mobile} onClick={() => setMobile(false)}>Ordinateur</button>
      <button type="button" className="btn-ghost" aria-pressed={mobile} onClick={() => setMobile(true)}>Mobile</button>
      {snapshot && <button type="button" className="btn-ghost" onClick={() => setRun((value) => value + 1)}>Recommencer</button>}
      {variants.length > 0 && <label>Variante A/B <select value={variant ?? ""} onChange={(event) => setVariant(event.target.value)}>
        {variants.map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>}
    </div>
    {loading && <p role="status">Validation du brouillon et du catalogue…</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {snapshot && <PreviewFrame snapshot={snapshot} variant={variant} run={run} mobile={mobile} />}
  </section>;
}
