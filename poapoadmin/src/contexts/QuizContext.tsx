import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
const MISSING_QUIZ_MESSAGE = "Quiz introuvable pour ce compte.";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Impossible de charger les quiz.";
}

function findSelectedQuiz(quizzes: Quiz[], requestedId: string | null): Quiz | null {
  if (requestedId === null) {
    return quizzes.find((quiz) => quiz.isDefault) ?? null;
  }

  return quizzes.find((quiz) => quiz.id === requestedId) ?? null;
}

export function QuizProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const hasTenant = !!user && user.tenantId !== "super-admin";

  const reload = useCallback(async () => {
    if (!hasTenant) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const items = await apiFetch<Quiz[]>("/api/quizzes");
      setQuizzes(items);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [hasTenant]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestedId = params.get("quizId");
  const quiz = findSelectedQuiz(quizzes, requestedId);
  const displayedError = error || (!loading && !quiz ? MISSING_QUIZ_MESSAGE : "");

  const selectQuiz = (id: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("quizId", id);
      return next;
    });
  };

  return (
    <QuizContext.Provider
      value={{
        quizzes,
        quiz,
        loading,
        error: displayedError,
        selectQuiz,
        reload,
      }}
    >
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz(): QuizContextValue {
  const context = useContext(QuizContext);
  if (!context) {
    throw new Error("QuizProvider manquant");
  }

  return context;
}

export function QuizSelector() {
  const { quizzes, quiz, selectQuiz } = useQuiz();

  return (
    <div className="field-group" style={{ marginBottom: "1rem" }}>
      <label className="field-label" htmlFor="quiz-selector">
        Quiz
      </label>
      <select
        id="quiz-selector"
        className="field-select"
        value={quiz?.id ?? ""}
        onChange={(event) => selectQuiz(event.target.value)}
      >
        {!quiz && <option value="">Choisir un quiz</option>}
        {quizzes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {item.isDefault ? " (par défaut)" : ""}
            {!item.active ? " — désactivé" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
