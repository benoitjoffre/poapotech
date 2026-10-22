import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Product } from "@poapo/types";
import { apiFetch } from "../lib/api";
import AxisSlider from "../components/AxisSlider";
import { useQuiz } from "../contexts/QuizContext";
import { catalogAxes, CatalogSelect, storedCatalogId, useCatalogs } from "../lib/catalogs";
import {
  EMPTY_PRODUCT_FORM,
  formToPayload,
  productToForm,
  type ProductFormState,
} from "../lib/productForm";

export default function ProductFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { quizzes, loading: quizzesLoading } = useQuiz();
  const [searchParams] = useSearchParams();
  const { catalogs, loading: catalogsLoading } = useCatalogs();
  const [catalogId, setCatalogId] = useState("");
  const axes = useMemo(() => catalogAxes(quizzes, catalogId), [quizzes, catalogId]);

  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!id) return;
    apiFetch<Product>(`/api/catalog/products/${id}`)
      .then(setProduct)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [id]);

  // Création : catalogue demandé (?catalogId), sinon dernier choisi, sinon catalogue principal.
  useEffect(() => {
    if (isEditing || catalogsLoading || catalogId) return;
    const requested = searchParams.get("catalogId") ?? storedCatalogId();
    const fallback = catalogs.find((catalog) => catalog.isDefault)?.id ?? catalogs[0]?.id ?? "";
    setCatalogId(catalogs.some((catalog) => catalog.id === requested) ? requested : fallback);
  }, [isEditing, catalogsLoading, catalogs, catalogId, searchParams]);

  useEffect(() => {
    if (product) setCatalogId(product.catalogId);
  }, [product]);

  // Les valeurs d'axes sont extraites des attributs une fois les axes des quiz connus.
  useEffect(() => {
    if (product && !quizzesLoading) setForm(productToForm(product, catalogAxes(quizzes, product.catalogId)));
  }, [product, quizzes, quizzesLoading]);

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setAxisValue = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, axisValues: { ...prev.axisValues, [key]: value } }));
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
      const payload = { ...formToPayload(form), ...(catalogId ? { catalogId } : {}) };
      if (isEditing) {
        await apiFetch(`/api/catalog/products/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        if (product && catalogId !== product.catalogId) setProduct({ ...product, catalogId });
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

  if (isLoading || (isEditing && quizzesLoading)) return <div className="loading-block">Chargement du produit...</div>;

  return (
    <div className="page page-form">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isEditing ? "Éditer un produit" : "Nouveau produit"}</h1>
          <p className="page-subtitle">{isEditing ? `ID : ${id}` : "Remplissez les informations du produit"}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate(catalogId ? `/catalog?catalogId=${encodeURIComponent(catalogId)}` : "/catalog")}>
          ← Retour
        </button>
      </div>

      <form className="product-form" onSubmit={handleSubmit}>
        {/* ── Identité ── */}
        <section className="form-section">
          <h2 className="section-title">Identité</h2>
          <div className="form-grid">
            <div className="field-span2">
              <CatalogSelect catalogs={catalogs} value={catalogId} onChange={setCatalogId} id="product-catalog" disabled={catalogsLoading} />
              {isEditing && product && catalogId !== product.catalogId && (
                <p className="field-hint">
                  Le produit sera déplacé. Ce déplacement est refusé s'il est sélectionné dans un quiz ; ses valeurs d'axes seront vérifiées pour le catalogue cible.
                </p>
              )}
            </div>
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
            <div className="field-group field-span2">
              <label className="field-label" htmlFor="tags">
                Tags (séparés par des virgules)
              </label>
              <input
                id="tags"
                className="field-input"
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="ex: bio, best-seller, édition limitée"
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

        {/* ── Axes de recommandation ── */}
        <section className="form-section">
          <h2 className="section-title">Axes de recommandation (0 – 1)</h2>
          {axes.length === 0 ? (
            <p className="section-hint">
              Aucun axe défini. Ajoutez des axes numériques dans la <Link to={`/quizzes?catalogId=${encodeURIComponent(catalogId)}`}>configuration des quiz de ce catalogue</Link>{" "}
              pour positionner vos produits.
            </p>
          ) : (
            <>
              <p className="section-hint">
                Positionnez le produit sur les axes définis dans les quiz de ce catalogue. Les réponses des visiteurs déplacent leur profil
                sur ces mêmes axes.
              </p>
              <div className="form-grid">
                {axes.map((axis) => (
                  <AxisSlider
                    key={axis.key}
                    id={`axis-${axis.key}`}
                    axis={axis}
                    value={form.axisValues[axis.key] ?? ""}
                    onChange={(value) => setAxisValue(axis.key, value)}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Caractéristiques libres ── */}
        <section className="form-section">
          <h2 className="section-title">Caractéristiques complémentaires</h2>
          <p className="section-hint">Informations propres à votre activité (objet JSON), utilisées pour enrichir la recommandation.</p>
          <textarea
            className="field-textarea"
            rows={5}
            value={form.attributes}
            onChange={(e) => set("attributes", e.target.value)}
            placeholder={'{"origine":"Éthiopie","matière":"coton bio"}'}
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
