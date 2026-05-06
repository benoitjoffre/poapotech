import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import type { TenantBranding } from "@poapo/types";
import { apiFetch } from "../lib/api";

interface BrandingForm {
  name: string;
  primaryColor: string;
  logoUrl: string;
  quizTitle: string;
  ctaText: string;
  embedDomain: string;
}

const EMPTY: BrandingForm = {
  name: "",
  primaryColor: "#6c47ff",
  logoUrl: "",
  quizTitle: "Trouve ton parfum idéal",
  ctaText: "Voir ce parfum",
  embedDomain: "",
};

export default function SettingsPage() {
  const { user } = useAuth();
  const defaultWidgetBaseUrl = import.meta.env.PROD ? "https://app.poapo-tech.com" : "http://localhost:5173";
  const widgetBaseUrl = String(import.meta.env.VITE_WIDGET_BASE_URL ?? defaultWidgetBaseUrl).replace(/\/$/, "");
  const [form, setForm] = useState<BrandingForm>(EMPTY);
  const [tenantId, setTenantId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Password section state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");
  const [isSavingPwd, setIsSavingPwd] = useState(false);

  useEffect(() => {
    apiFetch<BrandingForm & { id: string; tenantId: string }>("/api/auth/me")
      .then((data) => {
        setTenantId(data.tenantId ?? data.id ?? "");
        setForm({
          name: data.name ?? "",
          primaryColor: data.primaryColor ?? "#6c47ff",
          logoUrl: data.logoUrl ?? "",
          quizTitle: data.quizTitle ?? "Trouve ton parfum idéal",
          ctaText: data.ctaText ?? "Voir ce parfum",
          embedDomain: data.embedDomain ?? "",
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  const set = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload: TenantBranding = {
        name: form.name || undefined,
        primaryColor: form.primaryColor || undefined,
        logoUrl: form.logoUrl || undefined,
        quizTitle: form.quizTitle || undefined,
        ctaText: form.ctaText || undefined,
        embedDomain: form.embedDomain || undefined,
      };
      await apiFetch("/api/auth/me/branding", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSuccess("Paramètres enregistrés ✓");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError("");
    setPwdSuccess("");
    if (newPassword.length < 8) {
      setPwdError("8 caractères minimum.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError("Les mots de passe ne correspondent pas.");
      return;
    }
    setIsSavingPwd(true);
    try {
      await apiFetch("/api/auth/me/password", {
        method: "PUT",
        body: JSON.stringify({ password: newPassword }),
      });
      setPwdSuccess("Mot de passe mis à jour ✓");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwdError((err as Error).message);
    } finally {
      setIsSavingPwd(false);
    }
  };

  const clientId = tenantId || user?.tenantId || "";
  const embedSnippet = `<script
  src="https://app.poapo-tech.com/poapo-widget.js"
  data-client-id="${clientId}"
  data-url="https://app.poapo-tech.com"
  data-label="Trouve ton parfum"
  data-color="${form.primaryColor || "#6c47ff"}"
  async
></script>`;

  if (isLoading) return <div className="loading-block">Chargement...</div>;

  return (
    <div className="page page-form">
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-subtitle">Personnalisation du widget et de votre espace</p>
        </div>
      </div>

      <form className="product-form" onSubmit={handleSubmit}>
        <section className="form-section">
          <h2 className="section-title">Identité</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="name">
                Nom de votre marque
              </label>
              <input id="name" className="field-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ma Parfumerie" />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="embedDomain">
                Domaine autorisé pour le widget
              </label>
              <input
                id="embedDomain"
                className="field-input"
                value={form.embedDomain}
                onChange={(e) => set("embedDomain", e.target.value)}
                placeholder="https://maparfumerie.com"
              />
            </div>
          </div>
        </section>

        <section className="form-section">
          <h2 className="section-title">Apparence du widget</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="primaryColor">
                Couleur principale
                <span className="color-preview" style={{ background: form.primaryColor }} />
              </label>
              <div className="color-row">
                <input
                  id="primaryColor"
                  type="color"
                  className="field-color"
                  value={form.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value)}
                />
                <input className="field-input" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="logoUrl">
                URL du logo
              </label>
              <input
                id="logoUrl"
                className="field-input"
                type="url"
                value={form.logoUrl}
                onChange={(e) => set("logoUrl", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="quizTitle">
                Titre du quiz
              </label>
              <input id="quizTitle" className="field-input" value={form.quizTitle} onChange={(e) => set("quizTitle", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="ctaText">
                Texte du bouton CTA
              </label>
              <input id="ctaText" className="field-input" value={form.ctaText} onChange={(e) => set("ctaText", e.target.value)} />
            </div>
          </div>
        </section>

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>

      <form className="product-form" onSubmit={handlePasswordSubmit}>
        <section className="form-section">
          <h2 className="section-title">Mot de passe de connexion</h2>
          <p className="section-hint">Définissez ou changez le mot de passe de votre compte.</p>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="newPassword">
                Nouveau mot de passe
              </label>
              <input
                id="newPassword"
                className="field-input"
                type="password"
                autoComplete="new-password"
                placeholder="8 caractères minimum"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPwdError("");
                  setPwdSuccess("");
                }}
                disabled={isSavingPwd}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="confirmPassword">
                Confirmer le mot de passe
              </label>
              <input
                id="confirmPassword"
                className="field-input"
                type="password"
                autoComplete="new-password"
                placeholder="Répétez le mot de passe"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPwdError("");
                }}
                disabled={isSavingPwd}
              />
            </div>
          </div>
          {pwdError && <div className="form-error">{pwdError}</div>}
          {pwdSuccess && <div className="form-success">{pwdSuccess}</div>}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={isSavingPwd || !newPassword}>
              {isSavingPwd ? "Enregistrement..." : "Mettre à jour le mot de passe"}
            </button>
          </div>
        </section>
      </form>

      <section className="form-section embed-section">
        <h2 className="section-title">Code d'intégration</h2>{" "}
        <p className="section-hint">Copiez ce script dans la page de votre site où vous souhaitez afficher le widget.</p>
        {clientId ? (
          <div className="snippet-block">
            <pre className="snippet-code">{embedSnippet}</pre>
            <button type="button" className="btn-ghost snippet-copy" onClick={() => void navigator.clipboard.writeText(embedSnippet)}>
              Copier
            </button>
          </div>
        ) : (
          <div className="form-error">clientId non disponible (reconnectez-vous).</div>
        )}
        <p className="section-hint">
          URL widget utilisée : <code>{widgetBaseUrl}</code> (configurable via <code>VITE_WIDGET_BASE_URL</code>).
        </p>
      </section>
    </div>
  );
}
