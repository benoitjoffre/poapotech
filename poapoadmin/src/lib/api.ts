const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "poapo_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
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

  return res.json() as Promise<T>;
}
