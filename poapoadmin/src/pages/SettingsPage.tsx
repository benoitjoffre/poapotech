import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import type { TenantBranding } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { Link } from "react-router-dom";
import { widgetBaseUrl as resolveWidgetBaseUrl } from "../lib/experienceLinks";

interface BrandingForm {
  name: string;
  industry: string;
  primaryColor: string;
  logoUrl: string;
  quizTitle: string;
  ctaText: string;
  embedDomain: string;
}

const DEFAULT_QUIZ_TITLE = "Trouve ton produit idéal";
const DEFAULT_CTA_TEXT = "Découvrir ma sélection";

const EMPTY: BrandingForm = {
  name: "",
  industry: "",
  primaryColor: "#6C47FF",
  logoUrl: "",
  quizTitle: DEFAULT_QUIZ_TITLE,
  ctaText: DEFAULT_CTA_TEXT,
  embedDomain: "",
};

export default function SettingsPage() {
  const { user } = useAuth();
  const widgetBaseUrl = resolveWidgetBaseUrl();
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
          industry: data.industry ?? "",
          primaryColor: data.primaryColor ?? "#6C47FF",
          logoUrl: data.logoUrl ?? "",
          quizTitle: data.quizTitle || DEFAULT_QUIZ_TITLE,
          ctaText: data.ctaText || DEFAULT_CTA_TEXT,
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
        industry: form.industry,
        primaryColor: form.primaryColor || undefined,
        logoUrl: form.logoUrl || undefined,
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
  src="${widgetBaseUrl}/poapo-widget.js"
  data-client-id="${clientId}"
  data-url="${widgetBaseUrl}"
  data-color="${form.primaryColor || "#6C47FF"}"
  async
></script>`;

  if (isLoading) return <div className="loading-block">Chargement...</div>;

  return (
    <div className="page page-form">
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-subtitle">Identité de votre espace. La configuration des quiz se prépare dans leurs brouillons.</p>
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
              <input id="name" className="field-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ma Boutique" />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="industry">
                Activité
              </label>
              <input
                id="industry"
                className="field-input"
                maxLength={80}
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                placeholder="ex. Café de spécialité, Cosmétique, Vin…"
              />
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
                placeholder="https://ma-marque.com"
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
              <input id="quizTitle" className="field-input" value={form.quizTitle} readOnly />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="ctaText">
                Texte du bouton CTA
              </label>
              <input id="ctaText" className="field-input" value={form.ctaText} readOnly />
            </div>
          </div>
          <p className="section-hint"><Link to="/quizzes">Préparer le titre, le CTA et les axes dans le brouillon du quiz</Link>. L'activité du compte ne modifie plus les quiz déjà créés.</p>
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
        <h2 className="section-title">Code d'intégration du quiz par défaut</h2>{" "}
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
