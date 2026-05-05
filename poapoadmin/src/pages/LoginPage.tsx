import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const { login, token, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Déjà connecté -> redirect
  useEffect(() => {
    if (token) navigate(user?.isSuperAdmin ? "/admin/tenants" : "/catalog", { replace: true });
  }, [token, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
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
      const body = (await res.json()) as { accessToken?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      await login(body.accessToken!);
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

        <form className="login-form" onSubmit={handleSubmit}>
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
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={isLoading}>
            {isLoading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
