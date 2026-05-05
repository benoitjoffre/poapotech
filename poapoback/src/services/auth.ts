import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";

const MAGIC_LINK_EXPIRES_MIN = Number(process.env.MAGIC_LINK_EXPIRES_MIN ?? 15);

// ─── Mailer ───────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(payload: { tenantId: string; email: string; isSuperAdmin?: boolean }): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  } as jwt.SignOptions);
}

// ─── Service ──────────────────────────────────────────────────────────────────
export async function sendMagicLink(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  // Upsert tenant — première connexion = création du compte
  const tenant = await prisma.tenant.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail },
    update: {},
  });

  // Invalider les tokens précédents non utilisés
  await prisma.magicToken.updateMany({
    where: { tenantId: tenant.id, used: false },
    data: { used: true },
  });

  // Générer un token sécurisé
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_MIN * 60 * 1000);

  await prisma.magicToken.create({
    data: { tenantId: tenant.id, tokenHash, expiresAt },
  });

  const verifyUrl = `${process.env.ADMIN_URL}/auth/verify?token=${rawToken}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: normalizedEmail,
    subject: "Votre lien de connexion Poapo",
    html: `
      <p>Bonjour,</p>
      <p>Cliquez sur ce lien pour vous connecter à votre back-office Poapo :</p>
      <p><a href="${verifyUrl}" style="font-size:16px;font-weight:bold;">${verifyUrl}</a></p>
      <p>Ce lien expire dans ${MAGIC_LINK_EXPIRES_MIN} minutes.</p>
      <p>Si vous n'avez pas demandé ce lien, ignorez cet email.</p>
    `,
  });
}

export async function verifyMagicToken(rawToken: string): Promise<{ accessToken: string }> {
  const tokenHash = hashToken(rawToken);

  const magicToken = await prisma.magicToken.findUnique({
    where: { tokenHash },
    include: { tenant: true },
  });

  if (!magicToken) throw new Error("Token invalide");
  if (magicToken.used) throw new Error("Token déjà utilisé");
  if (new Date() > magicToken.expiresAt) throw new Error("Token expiré");
  if (!magicToken.tenant.active) throw new Error("Compte désactivé");

  // Marquer comme utilisé
  await prisma.magicToken.update({
    where: { id: magicToken.id },
    data: { used: true },
  });

  const accessToken = signAccessToken({ tenantId: magicToken.tenantId, email: magicToken.tenant.email });

  return { accessToken };
}

// ─── Password-based auth ──────────────────────────────────────────────────────
export async function loginWithPassword(email: string, password: string): Promise<{ accessToken: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (superAdminEmail && superAdminPassword && normalizedEmail === superAdminEmail && password === superAdminPassword) {
    return {
      accessToken: signAccessToken({
        tenantId: "super-admin",
        email: normalizedEmail,
        isSuperAdmin: true,
      }),
    };
  }

  const tenant = await prisma.tenant.findUnique({ where: { email: normalizedEmail } });

  if (!tenant) throw new Error("Email ou mot de passe incorrect");
  if (!tenant.active) throw new Error("Compte désactivé");
  if (!tenant.passwordHash) throw new Error("Aucun mot de passe défini pour ce compte. Utilisez le lien magique ou contactez l'administrateur.");

  const valid = await bcrypt.compare(password, tenant.passwordHash);
  if (!valid) throw new Error("Email ou mot de passe incorrect");

  const accessToken = signAccessToken({ tenantId: tenant.id, email: tenant.email });

  return { accessToken };
}

export async function setPassword(tenantId: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.tenant.update({ where: { id: tenantId }, data: { passwordHash } });
}
