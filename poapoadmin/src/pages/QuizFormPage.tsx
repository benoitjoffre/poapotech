import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Quiz, QuizInput } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";
import { storedCatalogId, useCatalogs } from "../lib/catalogs";
import { useQuizEditorDraft } from "../hooks/useQuizEditorDraft";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import QuizDraftStatus from "../components/QuizDraftStatus";
import {
  EMPTY_CONFIG as EMPTY, QuizAxesFields, QuizGeneralFields, QuizProductSelection, toDraftConfig, useCatalogProducts,
} from "../components/quizEditor/QuizConfigFields";

export default function QuizFormPage() {
  const { quizId } = useParams();
  const { reload } = useQuiz();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [savedForm, setSavedForm] = useState(EMPTY);
  const editor = useQuizEditorDraft(quizId);
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  useLeaveGuard(!!quizId && dirty, "La configuration du brouillon contient des modifications non enregistrées. Quitter ?");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [searchParams] = useSearchParams();
  const { catalogs, loading: catalogsLoading } = useCatalogs();
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
        if (cancelled) return;
        setQuiz(existing);
        if (!existing) { setForm(EMPTY); setSavedForm(EMPTY); }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [quizId]);
  useEffect(() => {
    if (!editor.state) return;
    const next = { ...editor.state.draft.config, axes: editor.state.draft.config.axes };
    setForm(next);
    setSavedForm(next);
  }, [editor.state]);
  // Nouveau quiz : catalogue demandé (?catalogId), sinon dernier choisi, sinon catalogue principal.
  useEffect(() => {
    if (quizId || loading || catalogsLoading || form.catalogId) return;
    const requested = searchParams.get("catalogId") ?? storedCatalogId();
    const fallback = catalogs.find((item) => item.isDefault)?.id ?? catalogs[0]?.id ?? "";
    const catalogId = catalogs.some((item) => item.id === requested) ? requested : fallback;
    if (catalogId) setForm((current) => ({ ...current, catalogId }));
  }, [quizId, loading, catalogsLoading, catalogs, form.catalogId, searchParams]);
  const { products: catalog, loading: productsLoading, error: productsError } = useCatalogProducts(form.catalogId);
  const changeCatalog = (catalogId: string) => {
    if (catalogId === form.catalogId) return;
    if (form.productIds.length > 0 && !window.confirm("Changer de catalogue retire les produits sélectionnés pour ce quiz. Continuer ?")) return;
    setForm({ ...form, catalogId, productIds: [] });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const config = toDraftConfig(form);
      if (quizId) {
        if (editor.draft && await editor.save({ ...editor.draft, config })) setSuccess("Brouillon enregistré. Le quiz public reste inchangé.");
        return;
      }
      const saved = await apiFetch<Quiz>("/api/quizzes", {
        method: "POST",
        body: JSON.stringify(config satisfies QuizInput),
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
  if (loading || editor.loading) return <div className="loading-block">Chargement...</div>;
  return (
    <div className="page page-form">
      <div className="page-header">
        <h1 className="page-title">{quizId ? "Configurer le brouillon du quiz" : "Nouveau quiz"}</h1>
        <Link className="btn-ghost" to={form.catalogId ? `/quizzes?catalogId=${encodeURIComponent(form.catalogId)}` : "/quizzes"}>Mes quiz</Link>
      </div>
      {(error || productsError) && <div className="form-error">{error || productsError}</div>}
      {success && !dirty && <div className="form-success">{success}</div>}
      {quizId && <QuizDraftStatus dirty={dirty} hasChanges={editor.state?.hasChanges ?? false}
        revision={editor.state?.revision ?? 0} saving={saving} conflict={editor.conflict} error={editor.error}
        onReload={() => {
          if (!dirty || confirm("Recharger et perdre la configuration locale non enregistrée ?")) { setSuccess(""); void editor.load(); }
        }}
        onDiscard={() => {
          if (confirm("Abandonner le brouillon complet, questions et configuration comprises ? Le quiz public restera inchangé.")) {
            setSuccess("");
            void editor.discard();
          }
        }} />}
      {(!quizId || quiz) && <form className="product-form" onSubmit={save}>
        <fieldset disabled={saving || (!!quizId && !editor.draft)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <QuizGeneralFields form={form} setForm={setForm} catalogs={catalogs} catalogsLoading={catalogsLoading}
          onCatalogChange={changeCatalog} canActivate={!!quizId} isDefault={quiz?.isDefault} />
        <QuizAxesFields form={form} setForm={setForm} publishedAxes={quiz?.axes ?? []} onError={setError} />
        <QuizProductSelection form={form} setForm={setForm} products={catalog} loading={productsLoading}
          catalogName={catalogs.find((item) => item.id === form.catalogId)?.name ?? "—"} />
        <p className="section-hint">{quizId && "Tous ces réglages, y compris l'activation, sont préparatoires. Ils ne modifient pas la version publique."}</p>
        <button className="btn-primary" disabled={saving || !form.catalogId || editor.conflict || (!!quizId && !dirty)} type="submit">{saving ? "Enregistrement..." : quizId ? "Enregistrer le brouillon" : "Créer le quiz"}</button>
        </fieldset>
      </form>}
      {quiz && <section className="form-section">
        <h2 className="section-title">Diffusion de la version publique</h2>
        <p className="section-hint">Ces liens ouvrent la version publique, pas le brouillon en préparation.</p>
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
