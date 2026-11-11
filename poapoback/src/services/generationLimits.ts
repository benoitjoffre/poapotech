import { MANUAL_IMPACT_LIMIT } from "./questions";
import { QuizError } from "./quizzes";

/** Limites et limiteur partagés par la création express et l'enrichissement IA. */
export const GENERATION_LIMITS = {
  minProducts: 2,
  maxProducts: 40,
  minQuestions: 3,
  maxQuestions: 6,
  maxDraftQuestions: 10,
  minAnswers: 2,
  maxAnswers: 6,
  instructions: 1000,
  generationImpact: 0.15,
  manualImpact: MANUAL_IMPACT_LIMIT,
} as const;

export const DRAFT_TEXT_LIMITS = { name: 120, quizTitle: 120, ctaText: 60, question: 300, helpText: 300, answer: 150, emoji: 16 } as const;

/** Écart minimal entre produits sur un axe pour qu'il serve à les départager. */
export const DISCRIMINANT_SPREAD = 0.2;
/** Amplitude cumulée en dessous de laquelle un axe bouge trop peu pour changer la recommandation. */
export const MIN_AXIS_AMPLITUDE = 0.3;
export const GENERATION_TIMEOUT_MS = 35_000;
export const PREVIEW_TIMEOUT_MS = 10_000;
export const MAX_GENERATION_ATTEMPTS = 2;
// ─── Limitation des appels IA ─────────────────────────────────────────────────

export interface LimiterMessages {
  busy: string;
  quota: (maxPerHour: number, remaining: number) => string;
}

const GENERATION_MESSAGES: LimiterMessages = {
  busy: "Une génération est déjà en cours pour votre compte",
  quota: (max) => `Limite de ${max} générations par heure atteinte, réessayez plus tard`,
};

/**
 * Un appel IA à la fois par tenant et un quota glissant par heure, exprimé en unités
 * (une génération de quiz, ou un produit estimé).
 * État en mémoire : propre à une instance du backend.
 */
export class GenerationLimiter {
  private inFlight = new Set<string>();
  private history = new Map<string, number[]>();

  constructor(
    private maxPerHour: number,
    private now: () => number = Date.now,
    private messages: LimiterMessages = GENERATION_MESSAGES,
  ) {}

  private recent(tenantId: string): number[] {
    const since = this.now() - 60 * 60 * 1000;
    return (this.history.get(tenantId) ?? []).filter((time) => time > since);
  }

  get limit() {
    return this.maxPerHour;
  }

  remaining(tenantId: string): number {
    return Math.max(0, this.maxPerHour - this.recent(tenantId).length);
  }

  acquire(tenantId: string, units = 1): () => void {
    if (this.inFlight.has(tenantId)) throw new QuizError(409, this.messages.busy);
    const recent = this.recent(tenantId);
    if (recent.length + units > this.maxPerHour) {
      throw new QuizError(429, this.messages.quota(this.maxPerHour, Math.max(0, this.maxPerHour - recent.length)));
    }
    const time = this.now();
    for (let i = 0; i < units; i++) recent.push(time);
    this.history.set(tenantId, recent);
    this.inFlight.add(tenantId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight.delete(tenantId);
    };
  }

  reset() {
    this.inFlight.clear();
    this.history.clear();
  }
}

const hourlyLimit = Number.parseInt(process.env.QUIZ_GENERATION_HOURLY_LIMIT ?? "", 10);
export const generationLimiter = new GenerationLimiter(Number.isInteger(hourlyLimit) && hourlyLimit > 0 ? hourlyLimit : 10);
