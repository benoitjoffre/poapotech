import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthToken } from "@poapo/types";
import { apiFetch, clearToken, getToken, setToken } from "../lib/api";

interface AuthContextValue {
  token: string | null;
  user: AuthToken | null;
  loading: boolean;
  login: (jwt: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  loading: true,
  login: async () => undefined,
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken);
  const [user, setUser] = useState<AuthToken | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const login = useCallback(async (jwt: string) => {
    setToken(jwt);
    setTokenState(jwt);
    const me = await apiFetch<AuthToken>("/api/auth/me");
    setUser(me);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<AuthToken>("/api/auth/me")
      .then((me) => setUser(me))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [token, logout]);

  return <AuthContext.Provider value={{ token, user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
