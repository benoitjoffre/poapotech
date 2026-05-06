import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const { token, user, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function readErrorMessage(res: Response): Promise<string> {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await res.json()) as { error?: string };
      return body.error ?? `Erreur ${res.status}`;
    }

    // Nginx/proxy errors can return HTML (502/504). Avoid JSON parse crashes.
    const text = await res.text();
    if (res.status === 502 || res.status === 504) {
      return "Le serveur met trop de temps a repondre. Reessayez dans quelques secondes.";
    }
    if (text.trim().startsWith("<")) {
      return `Erreur serveur ${res.status}`;
    }
    return text || `Erreur ${res.status}`;
  }

  useEffect(() => {
    if (token) navigate(user?.isSuperAdmin ? "/admin/tenants" : "/catalog", { replace: true });
  }, [token, user, navigate]);

  const handleSubmitMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Email requis.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Email et mot de passe requis.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const body = (await res.json()) as { accessToken?: string };
      if (!body.accessToken) throw new Error("Token manquant");
      await login(body.accessToken);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">poapo</div>
        <div className="login-title">Back-office</div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, opacity: mode === "magic" ? 1 : 0.7 }}
            onClick={() => {
              setMode("magic");
              setError("");
              setSent(false);
            }}
            disabled={isLoading}
          >
            Magic link
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, opacity: mode === "password" ? 1 : 0.7 }}
            onClick={() => {
              setMode("password");
              setError("");
              setSent(false);
            }}
            disabled={isLoading}
          >
            Mot de passe
          </button>
        </div>

        {mode === "magic" && sent ? (
          <div style={{ textAlign: "center", color: "#4b5563", marginTop: "1rem" }}>
            <p>
              Lien de connexion envoyé à <strong>{email}</strong>.
            </p>
            <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>Vérifiez vos emails (et vos spams).</p>
          </div>
        ) : (
          <form className="login-form" onSubmit={mode === "magic" ? handleSubmitMagic : handleSubmitPassword}>
            <label className="field-label" htmlFor="email">
              Adresse email
            </label>
            <input
              id="email"
              className="field-input"
              type="email"
              autoComplete="email"
              placeholder="toi@marque.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />
            {mode === "password" && (
              <>
                <label className="field-label" htmlFor="password">
                  Mot de passe
                </label>
                <input
                  id="password"
                  className="field-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <button className="btn-primary" type="submit" disabled={isLoading}>
              {mode === "magic" ? (isLoading ? "Envoi..." : "Recevoir le lien de connexion") : isLoading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
