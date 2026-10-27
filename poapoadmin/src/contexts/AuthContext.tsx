import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { useNavigate } from "react-router-dom";
import type { AuthToken } from "@poapo/types";
import { apiFetch, clearToken, getToken, setToken, setTokenProvider } from "../lib/api";
import { auth0Config, auth0Configured } from "../lib/auth0Config";

interface AuthContextValue {
  token: string | null;
  user: AuthToken | null;
  loading: boolean;
  /** true quand l'administration s'authentifie via Auth0 (sinon : connexion de développement historique). */
  auth0: boolean;
  login: (jwt: string) => Promise<void>;
  logout: () => void;
  /** Auth0 : ouvre la page de connexion (ou d'inscription) hébergée par Auth0. */
  signIn: (signup?: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  loading: true,
  auth0: false,
  login: async () => undefined,
  logout: () => undefined,
  signIn: async () => undefined,
  refreshUser: async () => undefined,
});

function LegacyAuthProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, loading, auth0: false, login, logout, signIn: async () => undefined, refreshUser: async () => undefined }),
    [token, user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, getAccessTokenSilently, loginWithRedirect, logout: auth0Logout } = useAuth0();
  const [user, setUser] = useState<AuthToken | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const refreshUser = useCallback(async () => {
    setUser(await apiFetch<AuthToken>("/api/auth/me"));
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setTokenProvider(null);
      setUser(null);
      setLoadingUser(false);
      return;
    }
    setTokenProvider(async () => (await getAccessTokenSilently()) ?? "");
    refreshUser().catch(() => setUser(null)).finally(() => setLoadingUser(false));
  }, [isAuthenticated, isLoading, getAccessTokenSilently, refreshUser]);

  const logout = useCallback(() => {
    setTokenProvider(null);
    setUser(null);
    // Termine aussi la session Auth0 (sinon la reconnexion serait silencieuse) ; le jeton d'accès reste court (≤ 1 h).
    void auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }, [auth0Logout]);

  const signIn = useCallback(
    (signup = false) => loginWithRedirect({ authorizationParams: signup ? { screen_hint: "signup" } : {} }),
    [loginWithRedirect],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token: isAuthenticated ? "auth0" : null, user, loading: isLoading || loadingUser, auth0: true,
      login: async () => undefined, logout, signIn, refreshUser,
    }),
    [isAuthenticated, user, isLoading, loadingUser, logout, signIn, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Auth0Root({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Auth0Provider
      domain={auth0Config.domain!}
      clientId={auth0Config.clientId!}
      authorizationParams={{ redirect_uri: window.location.origin, audience: auth0Config.audience, scope: "openid profile email" }}
      useRefreshTokens
      useRefreshTokensFallback
      onRedirectCallback={(state) => navigate(state?.returnTo ?? "/", { replace: true })}
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return auth0Configured ? <Auth0Root>{children}</Auth0Root> : <LegacyAuthProvider>{children}</LegacyAuthProvider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
