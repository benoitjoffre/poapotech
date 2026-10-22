import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";

const MAGIC_LINK_EXPIRES_MIN = Number(process.env.MAGIC_LINK_EXPIRES_MIN ?? 15);
const MAGIC_LINK_EXPIRES_MS = MAGIC_LINK_EXPIRES_MIN * 60 * 1000;

type AccessTokenPayload = {
  tenantId: string;
  email: string;
  isSuperAdmin?: boolean;
};

const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  } as jwt.SignOptions);
}

async function createMagicLinkToken(tenantId: string): Promise<string> {
  await prisma.magicToken.updateMany({
    where: { tenantId, used: false },
    data: { used: true },
  });

  const rawToken = crypto.randomBytes(32).toString("hex");

  await prisma.magicToken.create({
    data: {
      tenantId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRES_MS),
    },
  });

  return rawToken;
}

async function sendMagicLinkEmail(email: string, rawToken: string): Promise<void> {
  const verifyUrl = `${process.env.ADMIN_URL}/auth/verify?token=${rawToken}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
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

export async function sendMagicLink(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);

  const tenant = await prisma.tenant.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail },
    update: {},
  });

  // Seul le hash est stocké en base ; le token brut est transmis par email.
  const rawToken = await createMagicLinkToken(tenant.id);
  await sendMagicLinkEmail(normalizedEmail, rawToken);
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

  await prisma.magicToken.update({
    where: { id: magicToken.id },
    data: { used: true },
  });

  const accessToken = signAccessToken({ tenantId: magicToken.tenantId, email: magicToken.tenant.email });

  return { accessToken };
}

export async function loginWithPassword(email: string, password: string): Promise<{ accessToken: string }> {
  const normalizedEmail = normalizeEmail(email);

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  const isSuperAdmin =
    superAdminEmail && superAdminPassword && normalizedEmail === superAdminEmail && password === superAdminPassword;

  if (isSuperAdmin) {
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
  if (password.length < 8) {
    throw new Error("Le mot de passe doit contenir au moins 8 caractères");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.tenant.update({ where: { id: tenantId }, data: { passwordHash } });
}
