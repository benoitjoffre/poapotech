const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "poapo_admin_token";

/** Mode Auth0 : le jeton d'accès est fourni (et renouvelé) par le SDK, jamais stocké par l'application. */
let tokenProvider: (() => Promise<string>) | null = null;
export function setTokenProvider(provider: (() => Promise<string>) | null): void {
  tokenProvider = provider;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** En-tête Authorization (jeton Auth0 renouvelé ou jeton de développement) pour les appels qui ne passent pas par apiFetch (envoi de fichiers). */
export async function authHeader(): Promise<Record<string, string>> {
  const token = tokenProvider ? await tokenProvider().catch(() => null) : getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const apiUrl = (path: string): string => `${apiBaseUrl}${path}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenProvider ? await tokenProvider().catch(() => null) : getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (!tokenProvider) clearToken();
    window.location.href = "/login";
    throw new ApiError(401, "Session expirée");
  }

  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* no-op */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
