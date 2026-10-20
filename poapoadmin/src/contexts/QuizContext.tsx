import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { Quiz } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

interface QuizContextValue {
  quizzes: Quiz[];
  quiz: Quiz | null;
  loading: boolean;
  error: string;
  selectQuiz: (id: string) => void;
  reload: () => Promise<void>;
}

const QuizContext = createContext<QuizContextValue | null>(null);

export function QuizProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (user?.isSuperAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setQuizzes(await apiFetch<Quiz[]>("/api/quizzes"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user?.isSuperAdmin]);
  useEffect(() => { void reload(); }, [reload]);
  const requestedId = params.get("quizId");
  const quiz = (requestedId === null ? quizzes.find((q) => q.isDefault) : quizzes.find((q) => q.id === requestedId)) ?? null;
  const selectQuiz = (id: string) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set("quizId", id);
    return next;
  });
  return (
    <QuizContext.Provider value={{
      quizzes, quiz, loading,
      error: error || (!loading && !quiz ? "Quiz introuvable pour ce compte." : ""),
      selectQuiz, reload,
    }}>
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() {
  const context = useContext(QuizContext);
  if (!context) throw new Error("QuizProvider manquant");
  return context;
}

export function QuizSelector() {
  const { quizzes, quiz, selectQuiz } = useQuiz();
  return (
    <div className="field-group" style={{ marginBottom: "1rem" }}>
      <label className="field-label" htmlFor="quiz-selector">Quiz</label>
      <select id="quiz-selector" className="field-select" value={quiz?.id ?? ""} onChange={(e) => selectQuiz(e.target.value)}>
        {!quiz && <option value="">Choisir un quiz</option>}
        {quizzes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}{item.isDefault ? " (par défaut)" : ""}{!item.active ? " — désactivé" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
