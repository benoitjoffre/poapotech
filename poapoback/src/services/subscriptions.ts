import { Prisma, type Subscription, type SubscriptionPlan, type SubscriptionSource } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { DEFAULT_PLAN } from "./planCatalog";
import { QuizError } from "./quizzes";

/**
 * Abonnements : cycle de vie uniquement (création, attribution promotionnelle, lecture du plan effectif).
 * Les droits et quotas qui en découlent vivent dans entitlements.ts ; aucun accès à un fournisseur de paiement ici.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export type EffectiveStatus = "ACTIVE" | "EXPIRED" | "CANCELED";

export interface EffectiveSubscription {
  plan: SubscriptionPlan;
  status: EffectiveStatus;
  source: SubscriptionSource;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Plan stocké lorsqu'il diffère du plan effectif (promotion expirée ou annulée). */
  storedPlan: SubscriptionPlan | null;
  /** Accès offert par le super-admin, en cours de validité. */
  promotional: boolean;
}

/** Pur : le plan effectif ne dépend que de la ligne stockée et de l'horloge, jamais d'une tâche planifiée. */
export function computeEffective(sub: Pick<Subscription, "plan" | "status" | "source" | "startsAt" | "endsAt"> | null, now = new Date()): EffectiveSubscription {
  if (!sub) return { plan: DEFAULT_PLAN, status: "ACTIVE", source: "SIGNUP", startsAt: null, endsAt: null, storedPlan: null, promotional: false };
  const expired = sub.endsAt !== null && sub.endsAt <= now;
  const notStarted = sub.startsAt > now;
  const degraded = sub.status !== "ACTIVE" || expired || notStarted;
  return {
    plan: degraded ? DEFAULT_PLAN : sub.plan,
    status: sub.status !== "ACTIVE" ? "CANCELED" : expired ? "EXPIRED" : "ACTIVE",
    source: sub.source,
    startsAt: sub.startsAt,
    endsAt: sub.endsAt,
    storedPlan: degraded && sub.plan !== DEFAULT_PLAN ? sub.plan : null,
    promotional: !degraded && sub.source === "PROMO",
  };
}

export async function effectiveSubscription(tenantId: string, now = new Date(), db: Db = prisma): Promise<EffectiveSubscription> {
  return computeEffective(await db.subscription.findUnique({ where: { tenantId } }), now);
}

/** Crée l'abonnement STARTER d'une nouvelle boutique ; idempotent (unique tenantId), n'écrase jamais l'existant. */
export async function ensureStarterSubscription(db: Db, tenantId: string): Promise<void> {
  const created = await db.subscription.createMany({ data: [{ tenantId, plan: "STARTER", source: "SIGNUP" }], skipDuplicates: true });
  if (created.count) {
    await db.subscriptionEvent.create({ data: { tenantId, actor: "system", action: "CREATED", toPlan: "STARTER", toSource: "SIGNUP" } });
  }
}

export interface PlanChangeInput { plan: unknown; endsAt?: unknown }

export function parsePlanChange(body: unknown, now = new Date()): { plan: SubscriptionPlan; endsAt: Date | null } {
  const b = (body ?? {}) as PlanChangeInput;
  if (b.plan !== "STARTER" && b.plan !== "PRO" && b.plan !== "BUSINESS") throw new QuizError(400, "Plan invalide (STARTER, PRO ou BUSINESS)");
  if (b.endsAt === undefined || b.endsAt === null || b.endsAt === "") return { plan: b.plan, endsAt: null };
  const endsAt = typeof b.endsAt === "string" ? new Date(b.endsAt) : null;
  if (!endsAt || Number.isNaN(endsAt.getTime())) throw new QuizError(400, "Date d'expiration invalide");
  if (endsAt <= now) throw new QuizError(400, "La date d'expiration doit être dans le futur");
  if (b.plan === "STARTER") throw new QuizError(400, "Une date d'expiration n'a pas de sens pour le plan STARTER");
  return { plan: b.plan, endsAt };
}

/** Attribution par le super-admin (PRO/BUSINESS offerts, ou retour à STARTER). Journalisée dans la même transaction. */
export async function setPromotionalPlan(tenantId: string, input: { plan: SubscriptionPlan; endsAt: Date | null }, actor: string) {
  return prisma.$transaction(async (db) => {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new QuizError(404, "Tenant introuvable");
    const previous = await db.subscription.findUnique({ where: { tenantId } });
    const source: SubscriptionSource = input.plan === "STARTER" ? "SIGNUP" : "PROMO";
    const data = { plan: input.plan, status: "ACTIVE" as const, source, startsAt: new Date(), endsAt: input.endsAt };
    const sub = await db.subscription.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
    await db.subscriptionEvent.create({
      data: {
        tenantId, actor, action: "PLAN_CHANGED",
        fromPlan: previous?.plan ?? null, fromSource: previous?.source ?? null,
        toPlan: input.plan, toSource: source, endsAt: input.endsAt,
      },
    });
    return sub;
  });
}

export const listSubscriptionEvents = (tenantId: string, take = 50) =>
  prisma.subscriptionEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take });
