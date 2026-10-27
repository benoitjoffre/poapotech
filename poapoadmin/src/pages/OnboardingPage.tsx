import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../lib/api";

/** Première connexion Auth0 : crée la boutique (nom, secteur, site facultatif). Le tenant est créé côté serveur. */
export default function OnboardingPage() {
  const { token, user, loading, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState("");
  const [industry, setIndustry] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) return <div className="loading-screen">Chargement...</div>;
  if (!token) return <Navigate to="/login" replace />;
  if (user && !user.onboardingRequired) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/auth/onboarding", { method: "POST", body: JSON.stringify({ shopName, industry, websiteUrl }) });
      await refreshUser();
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (user && !user.emailVerified) {
    return (
      <div className="login-page"><div className="login-card">
        <div className="login-logo">poapo</div>
        <div className="login-title">Vérifiez votre adresse email</div>
        <p style={{ margin: "1rem 0" }}>Un email de confirmation a été envoyé à {user.email}. Cliquez sur le lien, puis revenez ici.</p>
        <button type="button" className="btn-primary" onClick={logout}>Me reconnecter après vérification</button>
      </div></div>
    );
  }

  return (
    <div className="login-page"><div className="login-card">
      <div className="login-logo">poapo</div>
      <div className="login-title">Créez votre boutique</div>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <label className="field-label" htmlFor="shopName">Nom de la boutique</label>
        <input id="shopName" className="field-input" required minLength={2} maxLength={80} value={shopName} onChange={(e) => setShopName(e.target.value)} />
        <label className="field-label" htmlFor="industry">Secteur d'activité</label>
        <input id="industry" className="field-input" required minLength={2} maxLength={80} placeholder="ex. Café de spécialité, Cosmétique…" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        <label className="field-label" htmlFor="websiteUrl">Site web (facultatif)</label>
        <input id="websiteUrl" className="field-input" placeholder="https://ma-boutique.fr" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
        {error && <p role="alert" className="login-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Création…" : "Créer ma boutique"}</button>
      </form>
    </div></div>
  );
}
