import { useEffect, useMemo, useRef, useState } from "react";
import type { GenderTarget, Question, QuizResult, SessionAnswer, MetricType } from "@poapo/types";
import { useTenant } from "../contexts/TenantContext";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

const moodOptions = [
  { value: "frais", label: "Frais" },
  { value: "boise", label: "Boisé" },
  { value: "floral", label: "Floral" },
  { value: "gourmand", label: "Gourmand" },
] as const;

type MoodValue = (typeof moodOptions)[number]["value"];

const genderOptions: { value: GenderTarget; label: string }[] = [
  { value: "female", label: "Femme" },
  { value: "male", label: "Homme" },
  { value: "unisex", label: "Unisex" },
];

// ── A/B variant helpers ────────────────────────────────────────────────────────

const AB_STORAGE_KEY = "poapo_ab_variant";

function pickAbVariant(questions: Question[]): string | null {
  const variants = [...new Set(questions.map((q) => q.abVariant).filter(Boolean))] as string[];
  if (variants.length === 0) return null;
  // Assign deterministically per session (or randomly on first visit)
  let stored = sessionStorage.getItem(AB_STORAGE_KEY);
  if (!stored || !variants.includes(stored)) {
    stored = variants[Math.floor(Math.random() * variants.length)];
    sessionStorage.setItem(AB_STORAGE_KEY, stored);
  }
  return stored;
}

// ── Conditional question filtering ────────────────────────────────────────────

/**
 * Returns the questions that should be displayed given the current set of
 * selected answer IDs and the A/B variant.
 */
function filterVisibleQuestions(allQuestions: Question[], selectedAnswerIds: Set<string>, abVariant: string | null): Question[] {
  return allQuestions.filter((q) => {
    // A/B: hide if assigned to a different variant
    if (q.abVariant && abVariant && q.abVariant !== abVariant) return false;
    // Conditional: show only if the required answer has been selected
    if (q.conditionAnswerId && !selectedAnswerIds.has(q.conditionAnswerId)) return false;
    return true;
  });
}

function QuizPage() {
  const { clientId, config } = useTenant();

  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [abVariant, setAbVariant] = useState<string | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(true);
  const [gender, setGender] = useState<GenderTarget | "">("");
  const [stepIndex, setStepIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedMood, setSelectedMood] = useState<MoodValue | "">("");

  // answers is keyed by questionId for stable conditional logic
  const [answersByQuestionId, setAnswersByQuestionId] = useState<Record<string, number>>({});
  const [result, setResult] = useState<(QuizResult & { sessionId?: string }) | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [hasTrackedStart, setHasTrackedStart] = useState(false);
  const [hasTrackedComplete, setHasTrackedComplete] = useState(false);
  const lastTrackedStepRef = useRef<string | null>(null);
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
        Object.entries(answersByQuestionId)
          .map(([qId, idx]) => {
            const q = questionById.get(qId);
            return q?.answers[idx]?.id ?? "";
          })
          .filter(Boolean),
      ),
    [answersByQuestionId, questionById],
  );

  // Questions filtered by variant and conditions
  const questions = useMemo(
    () => filterVisibleQuestions(allQuestions, selectedAnswerIds, abVariant),
    [allQuestions, selectedAnswerIds, abVariant],
  );
  // answers array aligned to visible questions
  const answers = useMemo(() => questions.map((q) => answersByQuestionId[q.id] ?? null), [questions, answersByQuestionId]);

  const questionsCount = questions.length;
  const answeredCount = answers.filter((v) => v !== null).length;
  const totalSteps = questionsCount + 1;
  const completedSteps = (gender ? 1 : 0) + answeredCount;
  const progressPercent = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
  const isGenderStep = stepIndex === 0;
  const currentQuestionIndex = stepIndex - 1;
  const isLastStep = stepIndex === totalSteps - 1;
  const currentQuestion = !isGenderStep ? questions[currentQuestionIndex] : null;
  const nextQuestion = !isGenderStep ? questions[currentQuestionIndex + 1] ?? null : questions[0] ?? null;

  const quizTitle = config?.quizTitle ?? "Trouve ton parfum idéal";
  const ctaText = config?.ctaText ?? "Voir ce parfum";

  const trackEvent = async (type: MetricType, payload: Record<string, unknown> = {}, { timeoutMs = 6000 } = {}): Promise<{ ok: boolean }> => {
    if (!clientId) return { ok: false };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBaseUrl}/api/quiz/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, type, payload }),
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
    if (!clientId) return;
    const url = `${apiBaseUrl}/api/quiz/track`;
    const body = JSON.stringify({ clientId, type, payload });

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

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoadingQuestions(true);
      setError("");
      try {
        const url = clientId ? `${apiBaseUrl}/api/quiz/questions?clientId=${encodeURIComponent(clientId)}` : `${apiBaseUrl}/api/quiz/questions`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Impossible de charger les questions.");
        const data = (await res.json()) as Question[];
        if (!Array.isArray(data)) throw new Error("Format de questions invalide.");
        if (isMounted) {
          setAllQuestions(data);
          setAbVariant(pickAbVariant(data));
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
  }, [clientId]);

  useEffect(() => {
    const moodParam = new URLSearchParams(window.location.search).get("mood") ?? "";
    const valid = moodOptions.find((o) => o.value === moodParam);
    if (valid) {
      setSelectedMood(valid.value);
      setHasStarted(true);
      startTimeRef.current = Date.now();
      if (!hasTrackedStart) {
        setHasTrackedStart(true);
        void trackEvent("quiz_start", { mood: valid.value });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question) return;
    setAnswersByQuestionId((prev) => ({ ...prev, [question.id]: optionIndex }));
    if (stepIndex < totalSteps - 1) {
      setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1));
    }

    const answer = question.answers[optionIndex];
    if (answer) {
      trackEventNoBlock("step_answer", {
        step: question.id,
        questionId: question.id,
        answerId: answer.id,
      });
    }
  };

  const buildSessionAnswers = (): SessionAnswer[] =>
    questions.reduce<SessionAnswer[]>((acc, question, idx) => {
      const selectedIdx = answers[idx];
      if (selectedIdx !== null && selectedIdx !== undefined) {
        const answer = question.answers[selectedIdx];
        if (answer) acc.push({ questionId: question.id, answerId: answer.id });
      }
      return acc;
    }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!gender) {
      setError("Merci de selectionner un genre avant de valider.");
      return;
    }
    if (answeredCount !== questionsCount) {
      setError("Merci de repondre a toutes les questions avant de valider.");
      return;
    }
    if (!clientId) {
      setError("Aucun clientId fourni (ex : ?clientId=xxx).");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          gender,
          mood: selectedMood || null,
          answers: buildSessionAnswers(),
          decisionTime: startTimeRef.current ? Date.now() - startTimeRef.current : undefined,
          abVariant: abVariant ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Une erreur est survenue. Merci de reessayer.");
      const data = (await res.json()) as QuizResult & { sessionId?: string };
      setResult(data);
      if (!hasTrackedComplete) {
        setHasTrackedComplete(true);
        void trackEvent("quiz_complete");
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
    setGender("");
    setAnswersByQuestionId({});
    setStepIndex(0);
    setIsProfileOpen(false);
    startTimeRef.current = null;
  };

  const handleStart = () => {
    setHasStarted(true);
    if (!startTimeRef.current) startTimeRef.current = Date.now();
    if (!hasTrackedStart) {
      setHasTrackedStart(true);
      void trackEvent("quiz_start", { mood: selectedMood || undefined });
    }
  };

  const handleMoodContinue = () => {
    if (!selectedMood) return;
    const params = new URLSearchParams(window.location.search);
    params.set("mood", selectedMood);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    handleStart();
  };

  useEffect(() => {
    if (!hasStarted || isLoadingQuestions || result) return;

    const step = isGenderStep ? "gender" : questions[currentQuestionIndex]?.id;
    if (!step || lastTrackedStepRef.current === step) return;

    lastTrackedStepRef.current = step;
    trackEventNoBlock("step_view", {
      step,
      stepIndex,
      questionId: isGenderStep ? null : questions[currentQuestionIndex]?.id,
    });
  }, [hasStarted, isLoadingQuestions, result, isGenderStep, questions, currentQuestionIndex, stepIndex]);

  useEffect(() => {
    if (!hasStarted) return;
    return () => {
      if (!hasTrackedComplete) {
        trackEventNoBlock("quiz_abandon", { stepIndex, at: new Date().toISOString() });
      }
    };
  }, [hasStarted, hasTrackedComplete, stepIndex, clientId]);

  const priceTierLabel: Record<string, string> = {
    entry: "Accessible",
    mid: "Milieu de gamme",
    luxury: "Luxe",
    niche: "Niche",
  };
  const genderLabel: Record<string, string> = {
    male: "Homme",
    female: "Femme",
    unisex: "Unisex",
  };
  const concentrationLabel: Record<string, string> = {
    EDT: "Eau de Toilette",
    EDP: "Eau de Parfum",
    Parfum: "Parfum Extrait",
    EDC: "Eau de Cologne",
    other: "Autre",
  };

  return (
    <div className="app">
      {!result && (
        <section className="intro">
          <div className="intro-logo">
            {config?.logoUrl ? <img src={config.logoUrl} alt={config.quizTitle ?? "logo"} /> : <img src="/poapo_logo.svg" alt="poapo" />}
          </div>
          <div className="intro-badge">Quiz de personnalité</div>
          <div className={`intro-layout ${hasStarted ? "collapsed" : ""}`}>
            <div className="intro-copy">
              <h1 className="title">
                {quizTitle.split(" ").slice(0, -1).join(" ")} <span className="title-accent">{quizTitle.split(" ").slice(-1)[0]}</span>
              </h1>
              <p>poapo recommande un parfum qui colle à ta peau, ton style de vie et tes émotions. Un quiz rapide, une reco ultra-personnalisée.</p>
            </div>
            {!hasStarted && (
              <div className="glass-card">
                <div className="glass-title">Signature olfactive</div>
                <div className="glass-subtitle">Un voyage sensoriel, en 11 questions.</div>
                <div className="glass-tags">
                  {moodOptions.map((mood) => {
                    const isSelected = selectedMood === mood.value;
                    return (
                      <button
                        key={mood.value}
                        type="button"
                        className={`glass-tag ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedMood(mood.value)}
                        aria-pressed={isSelected}
                      >
                        {mood.label}
                      </button>
                    );
                  })}
                </div>
                <div className="glass-tags-actions">
                  <button className="secondary glass-continue" type="button" disabled={!selectedMood} onClick={handleMoodContinue}>
                    Continuer
                  </button>
                </div>
                <div className="glass-foot">Selectionne tes moods, on s'occupe du reste.</div>
              </div>
            )}
          </div>
          {!hasStarted ? (
            <div className="hero-actions">
              <button className="submit" type="button" onClick={handleStart}>
                Commencer le quiz
              </button>
              <div className="hero-subtext">11 questions · 1 minute · Recommandation immediate</div>
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
        </section>
      )}

      {!result && hasStarted && (
        <form className="quiz" onSubmit={handleSubmit}>
          {isLoadingQuestions && <div className="question-card">Chargement des questions...</div>}

          {!isLoadingQuestions && isGenderStep && (
            <div className="question-card animate">
              <div className="question-title">Quel genre te correspond ?</div>
              <div className="options">
                {genderOptions.map((option) => {
                  const checked = gender === option.value;
                  return (
                    <label key={option.value} className={`option ${checked ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="gender"
                        value={option.value}
                        checked={checked}
                        onChange={() => {
                          setGender(option.value);
                          setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1));
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {!isLoadingQuestions && !isGenderStep && currentQuestion && (
            <div className="question-card animate" key={currentQuestion.id}>
              <div className="question-title">
                {stepIndex}. {currentQuestion.text}
              </div>
              {currentQuestion.helpText && <div className="question-help-text">{currentQuestion.helpText}</div>}
              <div className="options">
                {currentQuestion.answers.map((answer, optionIndex) => {
                  const checked = answers[currentQuestionIndex] === optionIndex;
                  return (
                    <label key={answer.id} className={`option ${checked ? "selected" : ""}`}>
                      <input
                        type="radio"
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
              Retour
            </button>
            {!isLastStep ? (
              <button
                className="submit"
                type="button"
                disabled={isLoadingQuestions || questionsCount === 0 || (isGenderStep ? !gender : answers[currentQuestionIndex] === null)}
                onClick={() => setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1))}
              >
                Suivant
              </button>
            ) : (
              <button
                className="submit"
                type="submit"
                disabled={isSubmitting || isLoadingQuestions || questionsCount === 0 || answeredCount !== questionsCount || !gender}
              >
                {isSubmitting ? "Envoi en cours..." : "Envoyer mes reponses"}
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
              <div className="result-hero-badge">✦ Votre match parfum</div>
              {result.product?.brand && <div className="result-hero-brand">{result.product.brand}</div>}
              <h2 className="result-hero-name">{result.product?.name}</h2>
              <div className="result-hero-meta">
                {result.product?.concentration && (
                  <span className="result-pill">{concentrationLabel[result.product.concentration] ?? result.product.concentration}</span>
                )}
                {result.product?.priceTier && (
                  <span className="result-pill">{priceTierLabel[result.product.priceTier] ?? result.product.priceTier}</span>
                )}
                {result.product?.genderTarget && (
                  <span className="result-pill">{genderLabel[result.product.genderTarget] ?? result.product.genderTarget}</span>
                )}
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

          {/* ── Notes olfactives ── */}
          {((result.product?.topNotes?.length ?? 0) > 0 ||
            (result.product?.heartNotes?.length ?? 0) > 0 ||
            (result.product?.baseNotes?.length ?? 0) > 0) && (
            <div className="result-notes">
              {(
                [
                  { label: "Tête", notes: result.product?.topNotes ?? [] },
                  { label: "Cœur", notes: result.product?.heartNotes ?? [] },
                  { label: "Fond", notes: result.product?.baseNotes ?? [] },
                ] as { label: string; notes: string[] }[]
              )
                .filter(({ notes }) => notes.length > 0)
                .map(({ label, notes }) => (
                  <div className="result-notes-col" key={label}>
                    <div className="result-notes-title">{label}</div>
                    <div className="chip-row">
                      {notes.map((note) => (
                        <span className="result-notes-chip" key={note}>
                          {note}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* ── Métriques ── */}
          {result.product && (
            <div className="result-metrics">
              <div className="metric">
                <div className="metric-label-row">
                  <span className="metric-label">Fraîcheur</span>
                  <span className="metric-word">{result.profileSummary?.freshnessLevel ?? "modérée"}</span>
                </div>
                <div className="metric-bar">
                  <span style={{ width: `${Math.round((result.product.freshness ?? 0) * 100)}%` }} />
                </div>
              </div>
              <div className="metric">
                <div className="metric-label-row">
                  <span className="metric-label">Intensité</span>
                  <span className="metric-word">{result.profileSummary?.intensityLevel ?? "élevée"}</span>
                </div>
                <div className="metric-bar">
                  <span style={{ width: `${Math.round((result.product.intensity ?? 0) * 100)}%` }} />
                </div>
              </div>
              <div className="metric">
                <div className="metric-label-row">
                  <span className="metric-label">Douceur</span>
                  <span className="metric-word">{result.profileSummary?.sensualityLevel ?? "très douce"}</span>
                </div>
                <div className="metric-bar">
                  <span style={{ width: `${Math.round((result.product.sweetness ?? 0) * 100)}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* ── Famille + Tags ── */}
          <div className="result-grid">
            <div>
              <div className="result-subtitle">Famille</div>
              <div className="chip-row">{result.product?.olfactoryFamily && <span className="chip">{result.product.olfactoryFamily}</span>}</div>
            </div>
            <div>
              <div className="result-subtitle">Tags</div>
              <div className="chip-row">
                {(result.product?.tags ?? []).map((tag, i) => (
                  <span className={`chip ${i === 0 ? "chip-primary" : ""}`} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Profil olfactif ── */}
          {result.profileSummary && (
            <div className="result-summary">
              <button type="button" className="accordion-toggle" onClick={() => setIsProfileOpen((prev) => !prev)} aria-expanded={isProfileOpen}>
                <span>Ton profil olfactif</span>
                <span className="accordion-icon">{isProfileOpen ? "−" : "+"}</span>
              </button>
              {isProfileOpen && (
                <div className="accordion-body">
                  <div className="result-caption">Voilà comment ton parfum s'exprime sur ta peau</div>
                  <div className="summary-grid">
                    <div className="summary-item">
                      <span className="summary-label">Fraîcheur</span>
                      <span className="summary-value">{result.profileSummary.freshnessLevel}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Intensité</span>
                      <span className="summary-value">{result.profileSummary.intensityLevel}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Sensualité</span>
                      <span className="summary-value">{result.profileSummary.sensualityLevel}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Moment</span>
                      <span className="summary-value">{result.profileSummary.usageMoment}</span>
                    </div>
                  </div>
                  {(result.profileSummary.univers ?? []).length > 0 && (
                    <div className="chip-row">
                      {result.profileSummary.univers.map((tag) => (
                        <span className="chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Actions finales ── */}
          <div className="result-footer-actions">
            {result.product?.purchaseUrl && (
              <a
                href={result.product.purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="result-cta-btn"
                onClick={() => void trackEvent("buy_click", { productId: result.product.id })}
              >
                {ctaText}
              </a>
            )}
            <button className="result-restart-btn" type="button" onClick={handleRestart}>
              Recommencer le quiz
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default QuizPage;
