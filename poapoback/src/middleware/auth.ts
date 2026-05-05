import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthToken } from "@poapo/types";

export interface AuthRequest extends Request {
  tenant?: AuthToken;
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthToken;
    req.tenant = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
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
