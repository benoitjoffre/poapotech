import { createHmac, timingSafeEqual } from "node:crypto";
import type { MetricType } from "@poapo/types";

// Événements réellement émis par le widget public. `feedback` et `decision_time` restent dans l'enum
// Prisma mais ne sont jamais envoyés : ils sont refusés sur l'endpoint public.
export const TRACKABLE_EVENT_TYPES = [
  "quiz_start", "quiz_complete", "quiz_abandon", "step_view", "step_answer", "buy_click",
] as const satisfies readonly MetricType[];
export type TrackableEventType = (typeof TRACKABLE_EVENT_TYPES)[number];

export const ABANDON_REASONS = ["pagehide", "unmount"] as const;

const MAX_ID_LENGTH = 100;
const MAX_VARIANT_LENGTH = 40;
const MAX_STEP_INDEX = 500;

type Spec = Record<string, "id" | "variant" | "index" | "abandonReason">;
interface Schema { required: Spec; optional: Spec }

const SCHEMAS: Record<TrackableEventType, Schema> = {
  quiz_start: { required: {}, optional: { abVariant: "variant" } },
  quiz_complete: { required: {}, optional: { abVariant: "variant" } },
  quiz_abandon: { required: { stepIndex: "index" }, optional: { reason: "abandonReason", abVariant: "variant" } },
  step_view: { required: { step: "id", stepIndex: "index", questionId: "id" }, optional: {} },
  step_answer: { required: { step: "id", questionId: "id", answerId: "id" }, optional: {} },
  buy_click: { required: { productId: "id" }, optional: { abVariant: "variant" } },
};

function validValue(kind: Spec[string], value: unknown): boolean {
  switch (kind) {
    case "id": return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
    case "variant": return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_VARIANT_LENGTH;
    case "index": return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_STEP_INDEX;
    case "abandonReason": return typeof value === "string" && (ABANDON_REASONS as readonly string[]).includes(value);
  }
}

export type TrackValidation = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

/** Valide strictement le type et la structure du payload ; les clés inconnues sont refusées. */
export function validateTrackEvent(type: unknown, payload: unknown): TrackValidation {
  if (typeof type !== "string" || !(TRACKABLE_EVENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Type d'événement invalide" };
  }
  const schema = SCHEMAS[type as TrackableEventType];
  if (payload !== undefined && payload !== null && (typeof payload !== "object" || Array.isArray(payload))) {
    return { ok: false, error: "Payload invalide" };
  }
  const input = (payload ?? {}) as Record<string, unknown>;
  const allowed = { ...schema.required, ...schema.optional };
  const unexpected = Object.keys(input).find((key) => !(key in allowed));
  if (unexpected) return { ok: false, error: `Champ inattendu : ${unexpected.slice(0, 40)}` };
  for (const [key, kind] of Object.entries(schema.required)) {
    if (!validValue(kind, input[key])) return { ok: false, error: `Champ requis invalide : ${key}` };
  }
  for (const [key, kind] of Object.entries(schema.optional)) {
    if (input[key] !== undefined && !validValue(kind, input[key])) return { ok: false, error: `Champ invalide : ${key}` };
  }
  return { ok: true, payload: Object.fromEntries(Object.keys(allowed).filter((key) => input[key] !== undefined).map((key) => [key, input[key]])) };
}

function feedbackSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant");
  return `feedback:${secret}`;
}

/** Preuve de possession délivrée uniquement dans la réponse de /submit : l'identifiant de session seul ne suffit pas. */
export function signFeedbackToken(sessionId: string, tenantId: string, quizId: string): string {
  return createHmac("sha256", feedbackSecret()).update(`${tenantId}\n${quizId}\n${sessionId}`).digest("base64url");
}

export function verifyFeedbackToken(token: unknown, sessionId: string, tenantId: string, quizId: string): boolean {
  if (typeof token !== "string") return false;
  const expected = Buffer.from(signFeedbackToken(sessionId, tenantId, quizId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function validateFeedback(feedback: unknown, reasons: unknown):
  { ok: true; feedback: "positive" | "negative"; reasons: string[] } | { ok: false; error: string } {
  if (feedback !== "positive" && feedback !== "negative") return { ok: false, error: "feedback invalide" };
  if (reasons === undefined) return { ok: true, feedback, reasons: [] };
  if (!Array.isArray(reasons) || reasons.length > 10 ||
      reasons.some((reason) => typeof reason !== "string" || reason.length === 0 || reason.length > 100)) {
    return { ok: false, error: "reasons invalide" };
  }
  return { ok: true, feedback, reasons: reasons as string[] };
}
