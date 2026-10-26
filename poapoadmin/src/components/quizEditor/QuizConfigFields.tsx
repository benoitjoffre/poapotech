import { useEffect, useState } from "react";
import { axisKeyFromLabel } from "../../lib/axisKey";
import type { CatalogSummary, Product, QuizAxis, QuizEditorDraft } from "@poapo/types";
import { apiFetch } from "../../lib/api";
import { CatalogSelect } from "../../lib/catalogs";

export type CatalogProduct = Pick<Product, "id" | "name" | "active" | "attributes">;
/** Un axe pas encore enregistré garde une clé modifiable (elle est ensuite référencée par les produits et réponses). */
export type AxisDraft = QuizAxis & { isNew?: boolean };
export type QuizConfigForm = Omit<QuizEditorDraft["config"], "axes"> & { axes: AxisDraft[] };

export const EMPTY_CONFIG: QuizConfigForm = {
  name: "", industry: "", axes: [], quizTitle: "Trouve ton produit idéal",
  ctaText: "Découvrir ma sélection", active: false, useAllProducts: true, productIds: [], catalogId: "",
};

export function toDraftConfig(form: QuizConfigForm): QuizEditorDraft["config"] {
  return { ...form, axes: form.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel })) };
}

export { axisKeyFromLabel };

/** Produits du catalogue du quiz, toutes pages confondues. */
export function useCatalogProducts(catalogId: string) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(!!catalogId);
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  useEffect(() => {
    setProducts([]);
    if (!catalogId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const all: CatalogProduct[] = [];
        let page = 1;
        let total = 0;
        do {
          const params = new URLSearchParams({ pageSize: "100", page: String(page++), catalogId });
          const result = await apiFetch<{ data: CatalogProduct[]; total: number }>(`/api/catalog/products?${params}`);
          all.push(...result.data);
          total = result.total;
          if (result.data.length === 0) break;
        } while (all.length < total);
        if (!cancelled) setProducts(all);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) { setLoading(false); setLoadedFor(catalogId); }
      }
    })();
    return () => { cancelled = true; };
  }, [catalogId]);
  return { products, loading, error, loadedFor };
}

type FormProps = { form: QuizConfigForm; setForm: (form: QuizConfigForm) => void };

export function QuizGeneralFields({ form, setForm, catalogs, catalogsLoading, onCatalogChange, canActivate, isDefault, showActivation = true }: FormProps & {
  catalogs: CatalogSummary[]; catalogsLoading: boolean; onCatalogChange: (catalogId: string) => void;
  canActivate: boolean; isDefault?: boolean; showActivation?: boolean;
}) {
  return <section className="form-section">
    <div className="form-grid">
      <div className="field-span2">
        <CatalogSelect catalogs={catalogs} value={form.catalogId} onChange={onCatalogChange} id="quiz-catalog" disabled={catalogsLoading} />
        <p className="field-hint">Le quiz recommande uniquement des produits de ce catalogue ; ses axes restent propres au quiz.</p>
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-name">Nom interne</label>
        <input id="quiz-name" className="field-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-industry">Activité</label>
        <input id="quiz-industry" className="field-input" maxLength={80} placeholder="ex. Café de spécialité, Cosmétique, Vin…"
          value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        <p className="field-hint">Décrit votre activité à l'IA pour contextualiser les recommandations.</p>
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-title">Titre public</label>
        <input id="quiz-title" className="field-input" required value={form.quizTitle} onChange={(e) => setForm({ ...form, quizTitle: e.target.value })} />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="quiz-cta">Texte du bouton résultat</label>
        <input id="quiz-cta" className="field-input" required value={form.ctaText} onChange={(e) => setForm({ ...form, ctaText: e.target.value })} />
      </div>
    </div>
    {showActivation && <label className="checkbox-label">
      <input type="checkbox" disabled={!canActivate} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      {canActivate ? "Activation préparée dans le brouillon (sans effet sur le quiz public)" : "Un nouveau quiz est créé inactif. Complétez-le puis publiez son brouillon pour l'activer."}
    </label>}
    {isDefault && <p className="section-hint">Ce quiz est utilisé par les anciens liens qui ne précisent pas de quizId.</p>}
  </section>;
}

export function QuizAxesFields({ form, setForm, publishedAxes, onError, title = "Axes de recommandation" }: FormProps & {
  publishedAxes: QuizAxis[]; onError: (message: string) => void; title?: string;
}) {
  return <section className="form-section">
    <h2 className="section-title">{title}</h2>
    <p className="section-hint">
      Définissez les critères numériques (0 à 1) propres à votre activité : par exemple « Acidité » pour un café,
      « Hydratation » pour un soin. Chaque produit est positionné sur ces axes et chaque réponse du quiz déplace le
      profil du visiteur ; le produit le plus proche est recommandé.
    </p>
    {form.axes.map((axis, index) => {
      const update = (patch: Partial<AxisDraft>) => setForm({
        ...form, axes: form.axes.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      });
      return <div key={index} className="form-grid axis-row">
        <div className="field-group">
          <label className="field-label" htmlFor={`axis-label-${index}`}>Libellé</label>
          <input id={`axis-label-${index}`} className="field-input" required value={axis.label} placeholder="ex. Acidité"
            onChange={(e) => update({ label: e.target.value, ...(axis.isNew && { key: axisKeyFromLabel(e.target.value) }) })} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`axis-key-${index}`}>Clé technique</label>
          <input id={`axis-key-${index}`} className="field-input" required pattern="[A-Za-z][A-Za-z0-9_]*" maxLength={40}
            value={axis.key} readOnly={!axis.isNew} title={axis.isNew ? "Lettres, chiffres et _ ; utilisée dans les imports CSV" : "La clé d'un axe enregistré ne peut plus changer"}
            onChange={(e) => update({ key: e.target.value })} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`axis-low-${index}`}>Libellé bas (0)</label>
          <input id={`axis-low-${index}`} className="field-input" value={axis.lowLabel ?? ""} placeholder="ex. Douce"
            onChange={(e) => update({ lowLabel: e.target.value })} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`axis-high-${index}`}>Libellé haut (1)</label>
          <input id={`axis-high-${index}`} className="field-input" value={axis.highLabel ?? ""} placeholder="ex. Vive"
            onChange={(e) => update({ highLabel: e.target.value })} />
        </div>
        <button type="button" className="btn-ghost" onClick={() => {
          if (publishedAxes.some((item) => item.key === axis.key)) {
            onError("Les clés des axes publiés sont conservées à cette étape. Vous pouvez modifier leurs libellés.");
            return;
          }
          if (!axis.isNew && !window.confirm(`Supprimer l'axe « ${axis.label} » du brouillon ?`)) return;
          setForm({ ...form, axes: form.axes.filter((_, i) => i !== index) });
        }}>Supprimer</button>
      </div>;
    })}
    <button id="quiz-add-axis" type="button" className="btn-ghost" disabled={form.axes.length >= 12}
      onClick={() => setForm({ ...form, axes: [...form.axes, { key: "", label: "", lowLabel: "", highLabel: "", isNew: true }] })}>
      + Ajouter un axe
    </button>
  </section>;
}

export function QuizProductSelection({ form, setForm, catalogName, products, loading }: FormProps & {
  catalogName: string; products: CatalogProduct[]; loading: boolean;
}) {
  return <section className="form-section">
    <h2 className="section-title">Produits recommandables</h2>
    <label className="checkbox-label">
      <input id="quiz-use-all-products" type="checkbox" checked={form.useAllProducts} onChange={(e) => setForm({ ...form, useAllProducts: e.target.checked })} />
      Tous les produits actifs du catalogue « {catalogName} » (y compris les futurs produits)
    </label>
    <p className="section-hint">Sélectionnez au besoin un sous-ensemble des produits de ce catalogue. Seuls les produits actifs sont recommandés.</p>
    {!form.useAllProducts && <>
      {loading && <p className="section-hint">Chargement des produits...</p>}
      {!loading && products.length === 0 && <p className="section-hint">Ce catalogue ne contient encore aucun produit.</p>}
      {products.map((product) => <label key={product.id} className="checkbox-label">
        <input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(e) => setForm({
          ...form, productIds: e.target.checked ? [...form.productIds, product.id] : form.productIds.filter((id) => id !== product.id),
        })} />
        {product.name}{!product.active ? " (inactif)" : ""}
      </label>)}
      {form.productIds.length === 0 && <p className="form-error">Sans produit sélectionné, ce quiz ne pourra pas recommander de produit.</p>}
    </>}
  </section>;
}
