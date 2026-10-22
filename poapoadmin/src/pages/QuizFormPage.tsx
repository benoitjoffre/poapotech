import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Quiz, QuizAxis, QuizInput } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";

type CatalogItem = { id: string; name: string; active: boolean };
/** Un axe pas encore enregistré garde une clé modifiable (elle est ensuite référencée par les produits et réponses). */
type AxisDraft = QuizAxis & { isNew?: boolean };
const EMPTY = {
  name: "", industry: "", axes: [] as AxisDraft[], quizTitle: "Trouve ton produit idéal",
  ctaText: "Découvrir ma sélection", active: true, useAllProducts: true, productIds: [] as string[],
};

/** « Niveau de torréfaction » → « niveauDeTorrefaction » */
function axisKeyFromLabel(label: string): string {
  const words = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const key = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .replace(/^[0-9]+/, "");
  return key.slice(0, 40);
}

export default function QuizFormPage() {
  const { quizId } = useParams();
  const { reload } = useQuiz();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const existing = quizId ? await apiFetch<Quiz>(`/api/quizzes/${encodeURIComponent(quizId)}`) : null;
        const products: CatalogItem[] = [];
        let page = 1;
        let total = 0;
        do {
          const result = await apiFetch<{ data: CatalogItem[]; total: number }>(`/api/catalog/products?pageSize=100&page=${page++}`);
          products.push(...result.data);
          total = result.total;
          if (result.data.length === 0) break;
        } while (products.length < total);
        if (cancelled) return;
        setQuiz(existing);
        setForm(existing ? {
          name: existing.name, industry: existing.industry, axes: existing.axes ?? [], quizTitle: existing.quizTitle, ctaText: existing.ctaText,
          active: existing.active, useAllProducts: existing.useAllProducts, productIds: existing.products.map((p) => p.productId),
        } : EMPTY);
        setCatalog(products);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [quizId]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await apiFetch<Quiz>(quizId ? `/api/quizzes/${encodeURIComponent(quizId)}` : "/api/quizzes", {
        method: quizId ? "PUT" : "POST",
        body: JSON.stringify({
          ...form,
          axes: form.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel })),
        } satisfies QuizInput),
      });
      await reload();
      setQuiz(saved);
      setForm((current) => ({ ...current, axes: saved.axes ?? [] }));
      setSuccess("Quiz enregistré.");
      if (!quizId) navigate(`/quizzes/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const widgetBase = String(import.meta.env.VITE_WIDGET_BASE_URL ?? (import.meta.env.PROD ? "https://app.poapo-tech.com" : "http://localhost:5173")).replace(/\/$/, "");
  const link = quiz ? `${widgetBase}/?${new URLSearchParams({ clientId: quiz.tenantId, quizId: quiz.id })}` : "";
  const snippet = quiz ? `<script src="${widgetBase}/poapo-widget.js" data-url="${widgetBase}" data-client-id="${quiz.tenantId}" data-quiz-id="${quiz.id}" async></script>` : "";
  if (loading) return <div className="loading-block">Chargement...</div>;
  return (
    <div className="page page-form">
      <div className="page-header">
        <h1 className="page-title">{quizId ? "Configurer le quiz" : "Nouveau quiz"}</h1>
        <Link className="btn-ghost" to="/quizzes">Mes quiz</Link>
      </div>
      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}
      {(!quizId || quiz) && <form className="product-form" onSubmit={save}>
        <section className="form-section">
          <div className="form-grid">
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
          <label className="checkbox-label">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Quiz actif (désactiver conserve les questions et les statistiques)
          </label>
          {quiz?.isDefault && <p className="section-hint">Ce quiz est utilisé par les anciens liens qui ne précisent pas de quizId.</p>}
        </section>
        <section className="form-section">
          <h2 className="section-title">Axes de recommandation</h2>
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
                if (!axis.isNew && !window.confirm(`Supprimer l'axe « ${axis.label} » ? Les impacts des réponses sur cet axe seront ignorés.`)) return;
                setForm({ ...form, axes: form.axes.filter((_, i) => i !== index) });
              }}>Supprimer</button>
            </div>;
          })}
          <button type="button" className="btn-ghost" disabled={form.axes.length >= 12}
            onClick={() => setForm({ ...form, axes: [...form.axes, { key: "", label: "", lowLabel: "", highLabel: "", isNew: true }] })}>
            + Ajouter un axe
          </button>
        </section>
        <section className="form-section">
          <h2 className="section-title">Produits recommandables</h2>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.useAllProducts} onChange={(e) => setForm({ ...form, useAllProducts: e.target.checked })} />
            Tout le catalogue du tenant (y compris les futurs produits)
          </label>
          <p className="section-hint">Pour un catalogue multi-activité, sélectionnez les produits adaptés à ce quiz. Seuls les produits actifs sont recommandés.</p>
          {!form.useAllProducts && <>
            {catalog.map((product) => <label key={product.id} className="checkbox-label">
              <input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(e) => setForm({
                ...form, productIds: e.target.checked ? [...form.productIds, product.id] : form.productIds.filter((id) => id !== product.id),
              })} />
              {product.name}{!product.active ? " (inactif)" : ""}
            </label>)}
            {form.productIds.length === 0 && <p className="form-error">Sans produit sélectionné, ce quiz ne pourra pas recommander de produit.</p>}
          </>}
        </section>
        <button className="btn-primary" disabled={saving} type="submit">{saving ? "Enregistrement..." : "Enregistrer"}</button>
      </form>}
      {quiz && <section className="form-section">
        <h2 className="section-title">Diffusion</h2>
        <p><a href={link} target="_blank" rel="noreferrer">Ouvrir le quiz</a></p>
        <p><Link to={`/quiz-builder?quizId=${encodeURIComponent(quiz.id)}`}>Modifier les questions</Link></p>
        <p><Link to={`/analytics?quizId=${encodeURIComponent(quiz.id)}`}>Voir les statistiques</Link></p>
        <label className="field-label" htmlFor="quiz-link">Lien direct</label>
        <input id="quiz-link" className="field-input" value={link} readOnly />
        <pre className="snippet-code">{snippet}</pre>
        <button className="btn-ghost" type="button" onClick={() => {
          navigator.clipboard.writeText(snippet).then(() => setSuccess("Code copié.")).catch((err: Error) => setError(err.message));
        }}>Copier le code</button>
      </section>}
    </div>
  );
}
