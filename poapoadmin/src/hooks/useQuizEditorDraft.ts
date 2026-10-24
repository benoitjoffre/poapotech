import { useCallback, useEffect, useRef, useState } from "react";
import type { QuizEditorDraft, QuizEditorDraftResponse } from "@poapo/types";
import { ApiError, apiFetch } from "../lib/api";

export function useQuizEditorDraft(quizId: string | undefined) {
  const [state, setState] = useState<QuizEditorDraftResponse | null>(null);
  const [draft, setDraft] = useState<QuizEditorDraft | null>(null);
  const [loading, setLoading] = useState(!!quizId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const path = `/api/quizzes/${encodeURIComponent(quizId ?? "")}/draft`;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(state?.draft);
  const fail = useCallback((err: unknown) => {
    setConflict(err instanceof ApiError && err.status === 409);
    setError(err instanceof Error ? err.message : "Erreur de sauvegarde du brouillon");
  }, []);

  const accept = useCallback((next: QuizEditorDraftResponse) => {
    setState(next);
    setDraft(next.draft);
    setError("");
    setConflict(false);
  }, []);

  const load = useCallback(async () => {
    if (!quizId || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      accept(await apiFetch<QuizEditorDraftResponse>(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le brouillon");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [quizId, path, accept]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setDraft(null);
    setError("");
    setConflict(false);
    if (!quizId) { setLoading(false); return; }
    setLoading(true);
    apiFetch<QuizEditorDraftResponse>(path).then((next) => {
      if (!cancelled) accept(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger le brouillon");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quizId, path, accept]);

  const write = async (method: "PUT" | "DELETE", content = draft) => {
    if (!state || !content || busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const next = await apiFetch<QuizEditorDraftResponse>(path, {
        method,
        body: JSON.stringify({ revision: state.revision, ...(method === "PUT" && { draft: content }) }),
      });
      accept(next);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return {
    state, draft, setDraft, loading, saving, dirty, error, conflict, load, accept, fail,
    save: (content = draft) => write("PUT", content),
    discard: () => write("DELETE"),
  };
}

export type QuizEditorSession = ReturnType<typeof useQuizEditorDraft>;
