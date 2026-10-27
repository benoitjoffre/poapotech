import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTVerifyGetKey } from "jose";

/** Claims ajoutés à l'access token par une Action Auth0 (les access tokens ne portent pas l'email par défaut). */
export const CLAIM_NAMESPACE = "https://poapo.app/";

export interface Auth0Identity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

export class AuthError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Émetteur Auth0 attendu, avec slash final (ex. https://poapo.eu.auth0.com/). null = Auth0 non configuré. */
export function auth0Issuer(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.AUTH0_ISSUER?.trim() || env.AUTH0_DOMAIN?.trim();
  if (!raw) return null;
  const base = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return base.endsWith("/") ? base : `${base}/`;
}

export const auth0Enabled = (env: NodeJS.ProcessEnv = process.env): boolean => !!auth0Issuer(env) && !!env.AUTH0_AUDIENCE?.trim();

/** Authentification historique (HS256 + magic link + mot de passe) : désactivée en production dès qu'Auth0 est configuré. */
export function legacyAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LEGACY_AUTH === "on") return true;
  if (env.LEGACY_AUTH === "off") return false;
  return !(env.NODE_ENV === "production" && auth0Enabled(env));
}

let jwksCache: { url: string; keys: JWTVerifyGetKey } | null = null;
function jwks(issuer: string): JWTVerifyGetKey {
  const url = env_jwksUrl(issuer);
  if (!jwksCache || jwksCache.url !== url) jwksCache = { url, keys: createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000 }) };
  return jwksCache.keys;
}
const env_jwksUrl = (issuer: string) => process.env.AUTH0_JWKS_URL?.trim() || `${issuer}.well-known/jwks.json`;

/** Vrai si le jeton est signé en RS256 (Auth0) ; les jetons HS256 historiques suivent le chemin legacy. */
export function isAsymmetricToken(token: string): boolean {
  try { return decodeProtectedHeader(token).alg === "RS256"; } catch { return false; }
}

/** Vérifie signature (JWKS), algorithme, issuer, audience et expiration. Jamais de décodage sans vérification. */
export async function verifyAuth0Token(token: string, env: NodeJS.ProcessEnv = process.env): Promise<Auth0Identity> {
  const issuer = auth0Issuer(env);
  const audience = env.AUTH0_AUDIENCE?.trim();
  if (!issuer || !audience) throw new AuthError(401, "Auth0 non configuré");
  try {
    const { payload } = await jwtVerify(token, jwks(issuer), { issuer, audience, algorithms: ["RS256"], clockTolerance: 5 });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("sub manquant");
    const email = payload[`${CLAIM_NAMESPACE}email`];
    return {
      sub: payload.sub,
      email: typeof email === "string" ? email.toLowerCase().trim() : null,
      emailVerified: payload[`${CLAIM_NAMESPACE}email_verified`] === true,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(401, "Invalid or expired token");
  }
}
