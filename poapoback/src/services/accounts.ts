import { Prisma, type MembershipRole } from "@prisma/client";
import { DEFAULT_PRIMARY_COLOR } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { AuthError, type Auth0Identity } from "./auth0";
import { ensureStarterSubscription } from "./subscriptions";

export interface ResolvedAccount { userId: string; tenantId: string; role: MembershipRole; email: string }

export const isSuperAdminEmail = (id: Auth0Identity, env: NodeJS.ProcessEnv = process.env): boolean =>
  id.emailVerified && !!id.email && id.email === env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();

/**
 * Compte POAPO d'une identité Auth0 : par `sub`, jamais par un tenantId fourni par le client.
 * Transition : un tenant historique (sans propriétaire) est rattaché une seule fois, uniquement si l'email Auth0 est vérifié et identique.
 */
export async function resolveAccount(id: Auth0Identity): Promise<ResolvedAccount | null> {
  const user = await prisma.user.findUnique({ where: { auth0Sub: id.sub }, include: { memberships: true } });
  if (user?.memberships[0]) {
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    const m = user.memberships[0];
    return { userId: user.id, tenantId: m.tenantId, role: m.role, email: user.email };
  }
  if (!id.email || !id.emailVerified) return null;
  const legacy = await prisma.tenant.findUnique({ where: { email: id.email }, include: { memberships: { select: { id: true } } } });
  if (!legacy || legacy.memberships.length > 0 || !legacy.active) return null;
  return linkAccount(id, legacy.id);
}

async function linkAccount(id: Auth0Identity, tenantId: string): Promise<ResolvedAccount | null> {
  try {
    const user = await prisma.user.upsert({ where: { auth0Sub: id.sub }, update: {}, create: { auth0Sub: id.sub, email: id.email! } });
    const m = await prisma.membership.create({ data: { userId: user.id, tenantId, role: "OWNER" } });
    return { userId: user.id, tenantId, role: m.role, email: user.email };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return resolveAccount(id); // double requête simultanée
    throw err;
  }
}

export interface OnboardingInput { shopName: string; industry: string; websiteUrl?: string | null }

export function validateOnboarding(body: unknown): OnboardingInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const shopName = typeof b.shopName === "string" ? b.shopName.trim() : "";
  const industry = typeof b.industry === "string" ? b.industry.trim() : "";
  let websiteUrl: string | null = null;
  if (typeof b.websiteUrl === "string" && b.websiteUrl.trim()) {
    const raw = b.websiteUrl.trim();
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) throw new Error();
      websiteUrl = url.toString().slice(0, 300);
    } catch { throw new AuthError(400, "Site web invalide", "invalid_website"); }
  }
  if (shopName.length < 2 || shopName.length > 80) throw new AuthError(400, "Le nom de la boutique doit contenir 2 à 80 caractères", "invalid_shop_name");
  if (industry.length < 2 || industry.length > 80) throw new AuthError(400, "Le secteur d'activité doit contenir 2 à 80 caractères", "invalid_industry");
  return { shopName, industry, websiteUrl };
}

/** Crée tenant + utilisateur + appartenance OWNER en une transaction ; idempotent (double clic, rechargement). */
export async function createShop(id: Auth0Identity, input: OnboardingInput): Promise<{ account: ResolvedAccount; created: boolean }> {
  if (!id.email || !id.emailVerified) throw new AuthError(403, "Vérifiez votre adresse email avant de créer votre boutique", "email_not_verified");
  const existing = await resolveAccount(id);
  if (existing) return { account: existing, created: false };
  const email = id.email;
  try {
    const account = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { email, name: input.shopName, industry: input.industry, websiteUrl: input.websiteUrl, primaryColor: DEFAULT_PRIMARY_COLOR },
      });
      await ensureStarterSubscription(tx, tenant.id);
      const user = await tx.user.upsert({ where: { auth0Sub: id.sub }, update: {}, create: { auth0Sub: id.sub, email } });
      const m = await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
      return { userId: user.id, tenantId: tenant.id, role: m.role, email };
    });
    return { account, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await resolveAccount(id);
      if (again) return { account: again, created: false };
      throw new AuthError(409, "Cet email est déjà associé à une autre boutique", "email_in_use");
    }
    throw err;
  }
}
