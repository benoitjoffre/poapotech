import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (token) navigate(user?.isSuperAdmin ? "/admin/tenants" : "/catalog", { replace: true });
  }, [token, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
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
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setSent(true);
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

        {sent ? (
          <div style={{ textAlign: "center", color: "#4b5563", marginTop: "1rem" }}>
            <p>Lien de connexion envoyé à <strong>{email}</strong>.</p>
            <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>Vérifiez vos emails (et vos spams).</p>
          </div>
        ) : (
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
            {error && <div className="form-error">{error}</div>}
            <button className="btn-primary" type="submit" disabled={isLoading}>
              {isLoading ? "Envoi..." : "Recevoir le lien de connexion"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
