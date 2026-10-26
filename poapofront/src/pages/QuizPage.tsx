import { useEffect, useMemo, useRef, useState } from "react";
import type { Question, QuizResult, SessionAnswer, MetricType, EmbedConfig, resolveQuizTheme } from "@poapo/types";
import { useTenant } from "../contexts/TenantContext";
import { filterVisibleQuestions, pickAbVariant } from "../lib/quiz";
import { createAbandonTracker } from "../lib/abandonTracker";
import QuizThemeStyle from "../components/QuizThemeStyle";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

export interface QuizPreviewRuntime {
  quizId: string;
  config: EmbedConfig;
  questions: Question[];
  abVariant: string | null;
  theme: ReturnType<typeof resolveQuizTheme>;
  submit: (answers: SessionAnswer[], abVariant: string | null) => Promise<QuizResult>;
}

export function QuizContent({ preview }: { preview?: QuizPreviewRuntime }) {
  const tenant = useTenant();
  const { clientId } = tenant;
  const quizId = preview?.quizId ?? tenant.quizId;
  const config = preview?.config ?? tenant.config;
  const labels = preview?.theme ?? config?.theme;

  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [abVariant, setAbVariant] = useState<string | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  // answers is keyed by questionId for stable conditional logic
  const [answersByQuestionId, setAnswersByQuestionId] = useState<Record<string, number | number[]>>({});
  const [result, setResult] = useState<(QuizResult & { sessionId?: string }) | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [hasTrackedStart, setHasTrackedStart] = useState(false);
  const [hasTrackedComplete, setHasTrackedComplete] = useState(false);
  const lastTrackedStepRef = useRef<string | null>(null);
  const abVariantRef = useRef<string | null>(null);
  const noBlockRef = useRef<(type: MetricType, payload?: Record<string, unknown>) => void>(() => undefined);
  const [abandonTracker] = useState(() => createAbandonTracker((payload) =>
    noBlockRef.current("quiz_abandon", { ...payload, abVariant: abVariantRef.current ?? "standard" })));
  const startTimeRef = useRef<number | null>(null);

  const questionById = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of allQuestions) map.set(q.id, q);
    return map;
  }, [allQuestions]);

  // Derived: set of selected answer IDs for conditional logic
  const selectedAnswerIds = useMemo(
    () =>
      new Set<string>(
        Object.entries(answersByQuestionId).flatMap(([qId, selection]) => {
          const question = questionById.get(qId);
          const selected = Array.isArray(selection) ? selection : [selection];
          return question ? selected.map((idx) => question.answers[idx]?.id ?? "").filter(Boolean) : [];
        }),
      ),
    [answersByQuestionId, questionById],
  );

  // Questions filtered by variant and conditions
  const questions = useMemo(() => filterVisibleQuestions(allQuestions, selectedAnswerIds, abVariant), [allQuestions, selectedAnswerIds, abVariant]);
  // answers array aligned to visible questions
  const answers = useMemo(() => questions.map((q) => answersByQuestionId[q.id] ?? null), [questions, answersByQuestionId]);

  const questionsCount = questions.length;
  const answeredCount = answers.filter((value) => (Array.isArray(value) ? value.length > 0 : value !== null)).length;
  const totalSteps = questionsCount;
  const completedSteps = answeredCount;
  const progressPercent = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
  const currentQuestionIndex = stepIndex;
  const isLastStep = stepIndex === totalSteps - 1;
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const nextQuestion = questions[currentQuestionIndex + 1] ?? null;

  const quizTitle = config?.quizTitle || "Trouve ton produit idéal";
  const ctaText = config?.ctaText || "Découvrir ma sélection";

  useEffect(() => {
    setStepIndex((index) => Math.max(0, Math.min(index, questions.length - 1)));
  }, [questions.length]);

  const trackEvent = async (type: MetricType, payload: Record<string, unknown> = {}, { timeoutMs = 6000 } = {}): Promise<{ ok: boolean }> => {
    if (preview) return { ok: true };
    if (!clientId) return { ok: false };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBaseUrl}/api/quiz/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, quizId, type, payload }),
        signal: controller.signal,
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Hot-path tracker for step interactions: non-blocking to keep UI snappy.
  const trackEventNoBlock = (type: MetricType, payload: Record<string, unknown> = {}): void => {
    if (preview) return;
    if (!clientId) return;
    const url = `${apiBaseUrl}/api/quiz/track`;
    const body = JSON.stringify({ clientId, quizId, type, payload });

    try {
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon(url, blob);
        if (sent) return;
      }
    } catch {
      // fallback below
    }

    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  };

  noBlockRef.current = trackEventNoBlock;
  abVariantRef.current = abVariant;

  useEffect(() => {
    if (preview) {
      setAllQuestions(preview.questions);
      setAbVariant(preview.abVariant);
      setIsLoadingQuestions(false);
      return;
    }
    let isMounted = true;
    const load = async () => {
      setIsLoadingQuestions(true);
      setError("");
      try {
        const params = new URLSearchParams({ clientId: clientId!, quizId: quizId! });
        const url = `${apiBaseUrl}/api/quiz/questions?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Impossible de charger les questions.");
        const data = (await res.json()) as Question[];
        if (!Array.isArray(data)) throw new Error("Format de questions invalide.");
        if (isMounted) {
          setAllQuestions(data);
          setAbVariant(pickAbVariant(data, quizId!));
          setAnswersByQuestionId({});
        }
      } catch (err) {
        if (isMounted) setError((err as Error).message || "Erreur chargement questions.");
      } finally {
        if (isMounted) setIsLoadingQuestions(false);
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, [clientId, quizId, preview]);

  const handleAnswer = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question) return;
    if (question.type === "multi") {
      setAnswersByQuestionId((prev) => {
        const previous = prev[question.id];
        const selected = Array.isArray(previous) ? previous : [];
        const next = selected.includes(optionIndex) ? selected.filter((index) => index !== optionIndex) : [...selected, optionIndex];
        return { ...prev, [question.id]: next };
      });
    } else {
      setAnswersByQuestionId((prev) => ({ ...prev, [question.id]: optionIndex }));
    }
    if (question.type === "single" && stepIndex < totalSteps - 1) {
      setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1));
    }

    const answer = question.answers[optionIndex];
    if (answer && question.type !== "multi") {
      trackEventNoBlock("step_answer", {
        step: question.id,
        questionId: question.id,
        answerId: answer.id,
      });
    }
  };

  const buildSessionAnswers = (): SessionAnswer[] =>
    questions.flatMap((question, idx) => {
      const selection = answers[idx];
      const indices = Array.isArray(selection) ? selection : typeof selection === "number" ? [selection] : [];
      return indices.flatMap((selectedIdx) => {
        const answer = question.answers[selectedIdx];
        return answer ? [{ questionId: question.id, answerId: answer.id }] : [];
      });
    });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setResult(null);
    if (answeredCount !== questionsCount) {
      setError("Merci de repondre a toutes les questions avant de valider.");
      return;
    }
    if (!clientId && !preview) {
      setError("Aucun clientId fourni (ex : ?clientId=xxx).");
      return;
    }
    setIsSubmitting(true);
    try {
      if (preview) {
        setResult(await preview.submit(buildSessionAnswers(), abVariant));
        setHasTrackedComplete(true);
        abandonTracker.complete();
        return;
      }
      const res = await fetch(`${apiBaseUrl}/api/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          quizId,
          answers: buildSessionAnswers(),
          decisionTime: startTimeRef.current ? Date.now() - startTimeRef.current : undefined,
          abVariant: abVariant ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Une erreur est survenue. Merci de reessayer.");
      const data = (await res.json()) as QuizResult & { sessionId?: string };
      setResult(data);
      abandonTracker.complete();
      // Choix multiples : une seule émission par option retenue, à la validation (évite les doublons de bascule).
      questions.forEach((question, idx) => {
        const selection = answers[idx];
        if (question.type !== "multi" || !Array.isArray(selection)) return;
        selection.forEach((selectedIdx) => {
          const answer = question.answers[selectedIdx];
          if (answer) trackEventNoBlock("step_answer", { step: question.id, questionId: question.id, answerId: answer.id });
        });
      });
      if (!hasTrackedComplete) {
        setHasTrackedComplete(true);
        void trackEvent("quiz_complete", { abVariant: abVariant ?? "standard" });
      }
      startTimeRef.current = null;
    } catch (err) {
      setError((err as Error).message || "Impossible de soumettre le quiz.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestart = () => {
    setResult(null);
    setError("");
    setAnswersByQuestionId({});
    setStepIndex(0);
    setIsProfileOpen(false);
    setHasStarted(false);
    setHasTrackedStart(false);
    setHasTrackedComplete(false);
    lastTrackedStepRef.current = null;
    startTimeRef.current = null;
    abandonTracker.reset();
  };

  const handleStart = () => {
    setHasStarted(true);
    abandonTracker.start();
    if (!startTimeRef.current) startTimeRef.current = Date.now();
    if (!hasTrackedStart) {
      setHasTrackedStart(true);
      void trackEvent("quiz_start", { abVariant: abVariant ?? "standard" });
    }
  };

  useEffect(() => {
    if (!hasStarted || isLoadingQuestions || result) return;

    const step = questions[currentQuestionIndex]?.id;
    if (!step || lastTrackedStepRef.current === step) return;

    lastTrackedStepRef.current = step;
    trackEventNoBlock("step_view", {
      step,
      stepIndex,
      questionId: questions[currentQuestionIndex]?.id,
    });
  }, [hasStarted, isLoadingQuestions, result, questions, currentQuestionIndex, stepIndex]);

  // Abandon : un seul événement, à la fermeture de la page ou au démontage d'un quiz démarré et non terminé.
  useEffect(() => {
    abandonTracker.setStep(stepIndex);
  }, [abandonTracker, stepIndex]);

  useEffect(() => {
    const onPageHide = () => abandonTracker.leave("pagehide");
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) abandonTracker.reopen(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      abandonTracker.leave("unmount");
    };
  }, [abandonTracker]);

  const profileAxes = result?.profileSummary?.axes ?? [];
  const productAttributes = result?.product?.attributes ?? {};
  const axisKeys = new Set(profileAxes.map((axis) => axis.key));
  const extraAttributes = Object.entries(productAttributes).filter(
    ([key, value]) => !axisKeys.has(key) && value !== null && typeof value !== "object",
  );

  return (
    <div className="app">
      {!preview && config && <QuizThemeStyle branding={config} theme={config.theme} />}
      {!result && (
        <section className="intro">
          <div className="intro-logo">
            {config?.logoUrl ? <img src={config.logoUrl} alt={config.tenantName ?? config.quizTitle ?? "logo"} /> : (
              <div className="intro-wordmark">
                <span className="intro-wordmark-name">{config?.tenantName?.trim() || "POAPO"}</span>
                {!config?.tenantName?.trim() && <span className="intro-wordmark-tagline">Trouvez ce qui vous correspond</span>}
              </div>
            )}
          </div>
          <div className={`intro-layout ${hasStarted ? "collapsed" : ""}`}>
            <div className="intro-copy">
              <h1 className="title">
                {quizTitle.split(" ").slice(0, -1).join(" ")} <span className="title-accent">{quizTitle.split(" ").slice(-1)[0]}</span>
              </h1>
              <p>Réponds à quelques questions et découvre la recommandation adaptée à tes préférences.</p>
            </div>
          </div>
          {!hasStarted ? (
            <div className="hero-actions">
              <button className="submit" type="button" onClick={handleStart} disabled={isLoadingQuestions || !!error || questionsCount === 0}>
                {labels?.startLabel ?? "Commencer le quiz"}
              </button>
              <div className="hero-subtext">{questionsCount} questions · Recommandation immédiate</div>
            </div>
          ) : (
            <>
              <div className="progress">
                <span>
                  {completedSteps} / {totalSteps} étapes
                </span>
                <span>{progressPercent}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </>
          )}
          {!hasStarted && error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {!isLoadingQuestions && !questionsCount && (
            <div className="form-error" role="alert">
              Aucune question visible pour ce parcours.
            </div>
          )}
        </section>
      )}

      {!result && hasStarted && (
        <form className="quiz" onSubmit={handleSubmit}>
          {isLoadingQuestions && <div className="question-card">Chargement des questions...</div>}

          {!isLoadingQuestions && currentQuestion && (
            <div className="question-card animate" key={currentQuestion.id}>
              <div className="question-title">
                {currentQuestionIndex + 1}. {currentQuestion.text}
              </div>
              {currentQuestion.helpText && <div className="question-help-text">{currentQuestion.helpText}</div>}
              {currentQuestion.type === "scale" ? (
                <div className="options">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, currentQuestion.answers.length - 1)}
                    step={1}
                    value={typeof answers[currentQuestionIndex] === "number" ? answers[currentQuestionIndex] : 0}
                    onChange={(event) => handleAnswer(currentQuestionIndex, Number(event.target.value))}
                    aria-label={currentQuestion.text}
                  />
                  <div className="question-help-text">
                    {currentQuestion.answers[typeof answers[currentQuestionIndex] === "number" ? answers[currentQuestionIndex] : 0]?.text}
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      handleAnswer(currentQuestionIndex, typeof answers[currentQuestionIndex] === "number" ? answers[currentQuestionIndex] : 0)
                    }
                  >
                    Choisir cette valeur
                  </button>
                </div>
              ) : (
                <div className="options">
                  {currentQuestion.answers.map((answer, optionIndex) => {
                    const selection = answers[currentQuestionIndex];
                    const checked = Array.isArray(selection) ? selection.includes(optionIndex) : selection === optionIndex;
                    return (
                      <label key={answer.id} className={`option ${checked ? "selected" : ""}`}>
                        <input
                          type={currentQuestion.type === "multi" ? "checkbox" : "radio"}
                          name={currentQuestion.id}
                          value={optionIndex}
                          checked={checked}
                          onChange={() => handleAnswer(currentQuestionIndex, optionIndex)}
                        />
                        <span>
                          {answer.emoji ? `${answer.emoji} ` : ""}
                          {answer.text}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Pre-render next question offscreen to reduce perceived transition latency */}
          {!isLoadingQuestions && hasStarted && nextQuestion && !result && (
            <div className="question-preload" aria-hidden="true">
              <div className="question-card">
                <div className="question-title">{nextQuestion.text}</div>
                {nextQuestion.helpText && <div className="question-help-text">{nextQuestion.helpText}</div>}
                <div className="options">
                  {nextQuestion.answers.map((answer) => (
                    <label key={answer.id} className="option">
                      <input type="radio" disabled />
                      <span>
                        {answer.emoji ? `${answer.emoji} ` : ""}
                        {answer.text}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="nav-actions">
            <button className="secondary" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}>
              {labels?.previousLabel ?? "Retour"}
            </button>
            {!isLastStep ? (
              <button
                className="submit"
                type="button"
                disabled={
                  isLoadingQuestions ||
                  questionsCount === 0 ||
                  (Array.isArray(answers[currentQuestionIndex]) ? answers[currentQuestionIndex].length === 0 : answers[currentQuestionIndex] === null)
                }
                onClick={() => setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1))}
              >
                {labels?.nextLabel ?? "Suivant"}
              </button>
            ) : (
              <button
                className="submit"
                type="submit"
                disabled={isSubmitting || isLoadingQuestions || questionsCount === 0 || answeredCount !== questionsCount}
              >
                {isSubmitting ? "Envoi en cours..." : (labels?.submitLabel ?? "Envoyer mes reponses")}
              </button>
            )}
          </div>
        </form>
      )}

      {result && (
        <section className="result">
          {/* ── Hero ── */}
          <div className="result-hero">
            {result.product?.imageUrl ? (
              <img className="result-hero-img" src={result.product.imageUrl} alt={result.product.name} loading="lazy" />
            ) : (
              <div className="result-hero-placeholder">
                <span className="result-hero-initial">{result.product?.brand?.[0] ?? result.product?.name?.[0] ?? "✦"}</span>
              </div>
            )}
            <div className="result-hero-overlay">
              <div className="result-hero-badge">✦ Votre sélection</div>
              {result.product?.brand && <div className="result-hero-brand">{result.product.brand}</div>}
              <h2 className="result-hero-name">{result.product?.name}</h2>
              <div className="result-hero-meta">
                {(result.product?.tags ?? []).slice(0, 3).map((tag) => (
                  <span className="result-pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Prix + description ── */}
          {(result.product?.price != null || result.product?.description) && (
            <div className="result-body">
              {result.product.price != null && <div className="result-price">À partir de {result.product.price} €</div>}
              {result.product?.description && <p className="result-description">{result.product.description}</p>}
            </div>
          )}

          {/* ── Explication ── */}
          {result.explanation.length > 0 && <p className="result-explanation">{result.explanation.join(" ")}</p>}

          {/* ── Profil sur les axes du quiz ── */}
          {profileAxes.length > 0 && (
            <div className="result-metrics">
              {profileAxes.map((axis) => {
                const productValue = productAttributes[axis.key];
                return (
                  <div className="metric" key={axis.key}>
                    <div className="metric-label-row">
                      <span className="metric-label">{axis.label}</span>
                      <span className="metric-word">{axis.description ?? axis.level}</span>
                    </div>
                    <div className="metric-bar">
                      <span style={{ width: `${Math.round((typeof productValue === "number" ? productValue : axis.value) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Caractéristiques ── */}
          {extraAttributes.length > 0 && (
            <div className="result-grid">
              {extraAttributes.map(([key, value]) => (
                <div key={key}>
                  <div className="result-subtitle">{key}</div>
                  <div className="chip-row">
                    <span className="chip">{String(value)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Profil du visiteur ── */}
          {profileAxes.length > 0 && (
            <div className="result-summary">
              <button type="button" className="accordion-toggle" onClick={() => setIsProfileOpen((prev) => !prev)} aria-expanded={isProfileOpen}>
                <span>Ton profil</span>
                <span className="accordion-icon">{isProfileOpen ? "−" : "+"}</span>
              </button>
              {isProfileOpen && (
                <div className="accordion-body">
                  <div className="result-caption">Ce que tes réponses disent de tes préférences</div>
                  <div className="summary-grid">
                    {profileAxes.map((axis) => (
                      <div className="summary-item" key={axis.key}>
                        <span className="summary-label">{axis.label}</span>
                        <span className="summary-value">{axis.description ?? axis.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Actions finales ── */}
          <div className="result-footer-actions">
            {result.product?.purchaseUrl && preview && (
              <button type="button" className="result-cta-btn" disabled title="Désactivé en mode aperçu : aucune conversion">
                {ctaText}
              </button>
            )}
            {result.product?.purchaseUrl && !preview && (
              <a
                href={result.product.purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="result-cta-btn"
                onClick={() => void trackEvent("buy_click", { productId: result.product.id, abVariant: abVariant ?? "standard" })}
              >
                {ctaText}
              </a>
            )}
            <button className="result-restart-btn" type="button" onClick={handleRestart}>
              {labels?.restartLabel ?? "Recommencer le quiz"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default function QuizPage() {
  const { loading, error, clientId, quizId } = useTenant();
  if (loading) return <div className="question-card">Chargement du quiz...</div>;
  if (error || !clientId || !quizId) return <div className="form-error">{error || "Lien de quiz incomplet : clientId requis."}</div>;
  return <QuizContent key={quizId} />;
}
