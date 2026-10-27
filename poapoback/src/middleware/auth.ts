import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthToken } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { AuthError, auth0Enabled, isAsymmetricToken, legacyAuthEnabled, verifyAuth0Token, type Auth0Identity } from "../services/auth0";
import { isSuperAdminEmail, resolveAccount } from "../services/accounts";

export const SUPER_ADMIN_TENANT_ID = "super-admin";

export interface AuthRequest extends Request {
  tenant?: AuthToken;
  role?: string;
}

// Le token super-admin ne porte pas de vrai tenant : il agit sur le tenant qui partage son email, s'il existe.
async function resolveSuperAdminTenant(token: AuthToken): Promise<AuthToken> {
  if (token.tenantId !== SUPER_ADMIN_TENANT_ID) return token;
  const tenant = await prisma.tenant.findUnique({
    where: { email: token.email.toLowerCase().trim() },
    select: { id: true },
  });
  return tenant ? { ...token, tenantId: tenant.id, isSuperAdmin: true } : token;
}

/** Identité Auth0 vérifiée (sans exiger de boutique) : /api/auth/me et l'onboarding. */
export interface AuthRequestWithIdentity extends AuthRequest {
  identity?: Auth0Identity;
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

async function authenticate(req: AuthRequestWithIdentity, requireTenant: boolean): Promise<void> {
  const token = bearer(req);
  if (!token) throw new AuthError(401, "Missing authorization header");

  if (isAsymmetricToken(token)) {
    if (!auth0Enabled()) throw new AuthError(401, "Invalid or expired token");
    const identity = await verifyAuth0Token(token);
    req.identity = identity;
    if (isSuperAdminEmail(identity)) {
      req.tenant = await resolveSuperAdminTenant({ tenantId: SUPER_ADMIN_TENANT_ID, email: identity.email!, isSuperAdmin: true });
      return;
    }
    const account = await resolveAccount(identity);
    if (account) {
      req.tenant = { tenantId: account.tenantId, email: account.email };
      req.role = account.role;
    } else if (requireTenant) {
      throw new AuthError(403, "Création de la boutique requise", "onboarding_required");
    }
    return;
  }

  // Jeton HS256 historique : comptes de développement et transition uniquement.
  if (!legacyAuthEnabled()) throw new AuthError(401, "Invalid or expired token");
  let decoded: AuthToken;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ["HS256"] }) as AuthToken;
  } catch {
    throw new AuthError(401, "Invalid or expired token");
  }
  req.tenant = await resolveSuperAdminTenant(decoded);
}

function guard(requireTenant: boolean) {
  return (req: AuthRequestWithIdentity, res: Response, next: NextFunction): void => {
    authenticate(req, requireTenant).then(() => next(), (err) => {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
        return;
      }
      next(err);
    });
  };
}

export const verifyToken = guard(true);
export const verifyIdentity = guard(false);

export function verifySuperAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  verifyToken(req, res, () => {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
    const byFlag = !!req.tenant?.isSuperAdmin;
    const byEmail = !!superAdminEmail && req.tenant?.email?.toLowerCase().trim() === superAdminEmail;
    if (!byFlag && !byEmail) {
      res.status(403).json({ error: "Accès réservé au super-admin" });
      return;
    }
    next();
  });
}
