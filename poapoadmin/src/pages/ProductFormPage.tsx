import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Product, ProductCreateInput, GenderTarget, PriceTier, Concentration, Season, Occasion, TimeOfDay } from "@poapo/types";
import { apiFetch } from "../lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function commaToArray(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function arrayToComma(arr: string[]): string {
  return arr.join(", ");
}

function parseFloat01(s: string): number | null {
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return Math.min(1, Math.max(0, n));
}

type FormState = {
  name: string;
  brand: string;
  description: string;
  price: string;
  priceTier: PriceTier | "";
  concentration: Concentration | "";
  imageUrl: string;
  purchaseUrl: string;
  olfactoryFamily: string;
  subFamily: string;
  genderTarget: GenderTarget | "";
  tags: string;
  topNotes: string;
  heartNotes: string;
  baseNotes: string;
  freshness: string;
  intensity: string;
  sweetness: string;
  seasons: Season[];
  occasions: Occasion[];
  timeOfDay: TimeOfDay[];
  active: boolean;
  featured: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  brand: "",
  description: "",
  price: "",
  priceTier: "",
  concentration: "",
  imageUrl: "",
  purchaseUrl: "",
  olfactoryFamily: "",
  subFamily: "",
  genderTarget: "",
  tags: "",
  topNotes: "",
  heartNotes: "",
  baseNotes: "",
  freshness: "",
  intensity: "",
  sweetness: "",
  seasons: [],
  occasions: [],
  timeOfDay: [],
  active: true,
  featured: false,
};

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    brand: p.brand ?? "",
    description: p.description ?? "",
    price: p.price != null ? String(p.price) : "",
    priceTier: p.priceTier ?? "",
    concentration: p.concentration ?? "",
    imageUrl: p.imageUrl ?? "",
    purchaseUrl: p.purchaseUrl ?? "",
    olfactoryFamily: p.olfactoryFamily ?? "",
    subFamily: p.subFamily ?? "",
    genderTarget: p.genderTarget ?? "",
    tags: arrayToComma(p.tags),
    topNotes: arrayToComma(p.topNotes),
    heartNotes: arrayToComma(p.heartNotes),
    baseNotes: arrayToComma(p.baseNotes),
    freshness: p.freshness != null ? String(p.freshness) : "",
    intensity: p.intensity != null ? String(p.intensity) : "",
    sweetness: p.sweetness != null ? String(p.sweetness) : "",
    seasons: p.seasons,
    occasions: p.occasions,
    timeOfDay: p.timeOfDay,
    active: p.active,
    featured: p.featured,
  };
}

function formToPayload(f: FormState): ProductCreateInput {
  return {
    name: f.name.trim(),
    brand: f.brand || null,
    description: f.description || null,
    price: f.price ? parseFloat(f.price) : null,
    priceTier: (f.priceTier as PriceTier) || null,
    concentration: (f.concentration as Concentration) || null,
    imageUrl: f.imageUrl || null,
    purchaseUrl: f.purchaseUrl || null,
    olfactoryFamily: f.olfactoryFamily || null,
    subFamily: f.subFamily || null,
    genderTarget: (f.genderTarget as GenderTarget) || null,
    tags: commaToArray(f.tags),
    topNotes: commaToArray(f.topNotes),
    heartNotes: commaToArray(f.heartNotes),
    baseNotes: commaToArray(f.baseNotes),
    freshness: parseFloat01(f.freshness),
    intensity: parseFloat01(f.intensity),
    sweetness: parseFloat01(f.sweetness),
    seasons: f.seasons,
    occasions: f.occasions,
    timeOfDay: f.timeOfDay,
    active: f.active,
    featured: f.featured,
  };
}

// ─── multi-select toggle helper ───────────────────────────────────────────────

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
}

function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <div className="multi-select">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`multi-opt ${value.includes(opt) ? "selected" : ""}`}
            onClick={() => onChange(toggle(value, opt))}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Chargement du produit existant
  useEffect(() => {
    if (!id) return;
    apiFetch<Product>(`/api/catalog/products/${id}`)
      .then((p) => setForm(productToForm(p)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Le nom est requis.");
      return;
    }
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = formToPayload(form);
      if (isEditing) {
        await apiFetch(`/api/catalog/products/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setSuccess("Produit mis à jour avec succès.");
      } else {
        const created = await apiFetch<Product>("/api/catalog/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        navigate(`/catalog/${created.id}/edit`, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="loading-block">Chargement du produit...</div>;

  return (
    <div className="page page-form">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isEditing ? "Éditer un produit" : "Nouveau produit"}</h1>
          <p className="page-subtitle">{isEditing ? `ID : ${id}` : "Remplissez les informations du parfum"}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate("/catalog")}>
          ← Retour
        </button>
      </div>

      <form className="product-form" onSubmit={handleSubmit}>
        {/* ── Identité ── */}
        <section className="form-section">
          <h2 className="section-title">Identité</h2>
          <div className="form-grid">
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="name">
                Nom *
              </label>
              <input id="name" className="field-input" value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="brand">
                Marque
              </label>
              <input id="brand" className="field-input" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="concentration">
                Concentration
              </label>
              <select
                id="concentration"
                className="field-select"
                value={form.concentration}
                onChange={(e) => set("concentration", e.target.value as Concentration | "")}
              >
                <option value="">—</option>
                {(["EDT", "EDP", "Parfum", "EDC", "other"] as const).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="price">
                Prix (€)
              </label>
              <input
                id="price"
                className="field-input"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="priceTier">
                Gamme de prix
              </label>
              <select
                id="priceTier"
                className="field-select"
                value={form.priceTier}
                onChange={(e) => set("priceTier", e.target.value as PriceTier | "")}
              >
                <option value="">—</option>
                {(["entry", "mid", "luxury", "niche"] as const).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                className="field-textarea"
                rows={3}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="imageUrl">
                URL image
              </label>
              <input id="imageUrl" className="field-input" type="url" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="purchaseUrl">
                URL d'achat
              </label>
              <input
                id="purchaseUrl"
                className="field-input"
                type="url"
                value={form.purchaseUrl}
                onChange={(e) => set("purchaseUrl", e.target.value)}
              />
            </div>
          </div>
          <div className="form-checkboxes">
            <label className="checkbox-label">
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
              Actif (visible dans les recommandations)
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} />
              Mis en avant
            </label>
          </div>
        </section>

        {/* ── Classification ── */}
        <section className="form-section">
          <h2 className="section-title">Classification olfactive</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="olfactoryFamily">
                Famille olfactive
              </label>
              <input
                id="olfactoryFamily"
                className="field-input"
                value={form.olfactoryFamily}
                onChange={(e) => set("olfactoryFamily", e.target.value)}
                placeholder="ex: Floral, Boisé, Oriental..."
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="subFamily">
                Sous-famille
              </label>
              <input id="subFamily" className="field-input" value={form.subFamily} onChange={(e) => set("subFamily", e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="genderTarget">
                Genre cible
              </label>
              <select
                id="genderTarget"
                className="field-select"
                value={form.genderTarget}
                onChange={(e) => set("genderTarget", e.target.value as GenderTarget | "")}
              >
                <option value="">—</option>
                <option value="male">Homme</option>
                <option value="female">Femme</option>
                <option value="unisex">Unisexe</option>
              </select>
            </div>
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="tags">
                Tags (séparés par des virgules)
              </label>
              <input
                id="tags"
                className="field-input"
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="ex: romantique, printanier, discret"
              />
            </div>
          </div>
        </section>

        {/* ── Pyramide olfactive ── */}
        <section className="form-section">
          <h2 className="section-title">Pyramide olfactive</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="topNotes">
                Notes de tête
              </label>
              <input
                id="topNotes"
                className="field-input"
                value={form.topNotes}
                onChange={(e) => set("topNotes", e.target.value)}
                placeholder="Bergamote, Citron..."
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="heartNotes">
                Notes de cœur
              </label>
              <input
                id="heartNotes"
                className="field-input"
                value={form.heartNotes}
                onChange={(e) => set("heartNotes", e.target.value)}
                placeholder="Rose, Jasmin..."
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="baseNotes">
                Notes de fond
              </label>
              <input
                id="baseNotes"
                className="field-input"
                value={form.baseNotes}
                onChange={(e) => set("baseNotes", e.target.value)}
                placeholder="Musc, Bois de santal..."
              />
            </div>
          </div>
        </section>

        {/* ── Axes numériques ── */}
        <section className="form-section">
          <h2 className="section-title">Axes numériques (0 – 1)</h2>
          <div className="form-grid">
            <div className="field-group">
              <label className="field-label" htmlFor="freshness">
                Fraîcheur
                {form.freshness && <span className="field-hint"> {Math.round(parseFloat(form.freshness) * 100)}%</span>}
              </label>
              <input
                id="freshness"
                className="field-input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={form.freshness || 0}
                onChange={(e) => set("freshness", e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="intensity">
                Intensité
                {form.intensity && <span className="field-hint"> {Math.round(parseFloat(form.intensity) * 100)}%</span>}
              </label>
              <input
                id="intensity"
                className="field-input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={form.intensity || 0}
                onChange={(e) => set("intensity", e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="sweetness">
                Douceur
                {form.sweetness && <span className="field-hint"> {Math.round(parseFloat(form.sweetness) * 100)}%</span>}
              </label>
              <input
                id="sweetness"
                className="field-input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={form.sweetness || 0}
                onChange={(e) => set("sweetness", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ── Contexte d'usage ── */}
        <section className="form-section">
          <h2 className="section-title">Contexte d'usage</h2>
          <MultiSelect
            label="Saisons"
            options={["spring", "summer", "autumn", "winter"] as const}
            value={form.seasons}
            onChange={(v) => set("seasons", v)}
          />
          <MultiSelect
            label="Occasions"
            options={["daily", "evening", "office", "sport", "special"] as const}
            value={form.occasions}
            onChange={(v) => set("occasions", v)}
          />
          <MultiSelect
            label="Moment de la journée"
            options={["morning", "afternoon", "evening", "night"] as const}
            value={form.timeOfDay}
            onChange={(v) => set("timeOfDay", v)}
          />
        </section>

        {/* ── Actions ── */}
        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={() => navigate("/catalog")}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? "Enregistrement..." : isEditing ? "Enregistrer les modifications" : "Créer le produit"}
          </button>
        </div>
      </form>
    </div>
  );
}
