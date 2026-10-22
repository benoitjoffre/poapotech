import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthToken } from "@poapo/types";
import { prisma } from "../lib/prisma";

export const SUPER_ADMIN_TENANT_ID = "super-admin";

export interface AuthRequest extends Request {
  tenant?: AuthToken;
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

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  let decoded: AuthToken;
  try {
    decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as AuthToken;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  resolveSuperAdminTenant(decoded)
    .then((tenant) => {
      req.tenant = tenant;
      next();
    })
    .catch(next);
}

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
