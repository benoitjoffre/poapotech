import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Quiz, QuizInput } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useCatalogs } from "../lib/catalogs";
import { experienceSetupPath } from "../lib/experienceLinks";
import { SECTOR_SUGGESTIONS } from "../lib/experienceWizard";
import { EMPTY_CONFIG } from "../components/quizEditor/QuizConfigFields";
import "../components/quizEditor/experienceEditor.css";
import "../components/quizEditor/experienceWizard.css";

/** Point d'entrée de « Créer une expérience » : crée un quiz inactif (API existante) puis ouvre l'assistant sur son quizId. */
export default function ExperienceCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const manual = params.get("mode") === "manual";
  const { catalogs, loading, error: catalogsError, reload } = useCatalogs();
  const requested = params.get("catalogId") ?? "";
  const [chosen, setChosen] = useState(requested);
  const [name, setName] = useState("");
  const [title, setTitle] = useState(EMPTY_CONFIG.quizTitle);
  const [industry, setIndustry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Un seul catalogue : sélection automatique. Plusieurs : choix explicite, jamais implicite.
  const catalogId = catalogs.length === 1 ? catalogs[0].id : catalogs.some((item) => item.id === chosen) ? chosen : "";
  const nameProblem = !name.trim() ? "Donnez un nom à votre expérience." : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (nameProblem) { setError(nameProblem); document.getElementById("create-name")?.focus(); return; }
    if (!catalogId) { setError("Choisissez le catalogue de produits de cette expérience."); return; }
    if (!title.trim()) { setError("Le titre public est obligatoire."); return; }
    setSubmitting(true);
    try {
      const input: QuizInput = {
        name: name.trim(), quizTitle: title.trim(), ctaText: EMPTY_CONFIG.ctaText, industry: industry.trim(),
        catalogId, axes: [], useAllProducts: true, productIds: [], active: false,
      };
      const quiz = await apiFetch<Quiz>("/api/quizzes", { method: "POST", body: JSON.stringify(input) });
      navigate(experienceSetupPath(quiz.id, 1), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "La création a échoué");
      setSubmitting(false);
    }
  }

  if (!manual) return <div className="page experience-editor xw-create">
    <Link className="table-link" to="/quizzes">← Retour aux expériences</Link>
    <h1 className="page-title">Créer une expérience</h1>
    <p className="section-hint">Choisissez comment démarrer. Vous pourrez tout modifier avant de publier.</p>
    <div className="xw-card">
      <Link className="btn-primary" to="/experiences/new/express">Création express — recommandée</Link>
      <p className="section-hint">POAPO analyse votre catalogue et prépare les critères, les questions et les réponses. Vous relisez, testez, puis enregistrez un brouillon.</p>
    </div>
    <div className="xw-card">
      <Link className="btn-ghost" to="/experiences/new/express?mode=template">Partir d'un modèle</Link>
      <p className="section-hint">Café, parfum, voyage ou mode : un jeu de critères et de questions types, adapté à ce que contiennent réellement vos produits.</p>
    </div>
    <div className="xw-card">
      <Link className="btn-ghost" to="/experiences/new?mode=manual">Création manuelle — avancée</Link>
      <p className="section-hint">Vous définissez vous-même les axes, les questions et les impacts, avec l'assistant en cinq étapes. L'import CSV reste disponible depuis le catalogue.</p>
    </div>
  </div>;

  return <div className="page experience-editor xw-create">
    <Link className="table-link" to="/experiences/new">← Autres façons de créer</Link>
    <h1 className="page-title">Créer une expérience</h1>
    <p className="section-hint">Un assistant en cinq étapes vous guide : produits, préférences, questions, apparence puis publication. Aucune campagne n'est nécessaire.</p>
    {loading && <div className="loading-block" role="status">Chargement de vos catalogues…</div>}
    {catalogsError && <div className="form-error" role="alert">{catalogsError}{" "}
      <button type="button" className="table-link" onClick={() => void reload()}>Réessayer</button></div>}
    {!loading && !catalogsError && catalogs.length === 0 && <div className="xp-state xp-empty" role="status">
      <p>Aucun catalogue n'est disponible. Créez d'abord un catalogue de produits.</p>
      <Link className="btn-primary" to="/catalogs">Gérer mes catalogues</Link>
    </div>}
    {!loading && catalogs.length > 0 && <form className="product-form xw-card" onSubmit={submit} noValidate>
      <h2 className="section-title">Informations de base</h2>
      <div className="form-grid">
        <div className="field-group">
          <label className="field-label" htmlFor="create-name">Nom de l'expérience</label>
          <input id="create-name" className="field-input" required maxLength={120} value={name} aria-invalid={!!error && !!nameProblem}
            onChange={(e) => setName(e.target.value)} placeholder="ex. Trouver mon prochain voyage" />
          <p className="field-hint">Nom interne, visible uniquement dans POAPO.</p>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="create-title">Titre public</label>
          <input id="create-title" className="field-input" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-hint">Affiché aux visiteurs en haut du quiz.</p>
        </div>
        <div className="field-group field-span2">
          <label className="field-label" htmlFor="create-industry">Activité (facultatif)</label>
          <input id="create-industry" className="field-input" maxLength={80} value={industry} onChange={(e) => setIndustry(e.target.value)}
            placeholder="ex. Voyage, Café, Parfum…" list="create-industry-options" />
          <datalist id="create-industry-options">{SECTOR_SUGGESTIONS.map((item) => <option key={item} value={item} />)}</datalist>
          <p className="field-hint">Sert uniquement à proposer des exemples de préférences adaptés. Rien n'est configuré automatiquement.</p>
        </div>
      </div>
      <fieldset className="xw-catalogs">
        <legend className="field-label">Catalogue de produits</legend>
        {catalogs.length === 1
          ? <p>Catalogue « {catalogs[0].name} » ({catalogs[0].activeProductCount} produit{catalogs[0].activeProductCount > 1 ? "s" : ""} actif{catalogs[0].activeProductCount > 1 ? "s" : ""}), sélectionné automatiquement car c'est votre seul catalogue.</p>
          : <>
            <p className="field-hint">Vous avez plusieurs catalogues : choisissez celui dont l'expérience recommandera les produits.</p>
            {catalogs.map((catalog) => <label key={catalog.id} className="xw-radio">
              <input type="radio" name="catalog" value={catalog.id} checked={catalogId === catalog.id} onChange={() => setChosen(catalog.id)} />
              <span><strong>{catalog.name}</strong><br /><span className="xe-muted">{catalog.activeProductCount} produit{catalog.activeProductCount > 1 ? "s" : ""} actif{catalog.activeProductCount > 1 ? "s" : ""}</span></span>
            </label>)}
          </>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="section-hint">L'expérience est créée inactive : elle ne sera accessible au public qu'après publication et activation.</p>
      <div className="xw-footer">
        <Link className="btn-ghost" to="/quizzes">Quitter</Link>
        <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Création…" : "Commencer l'assistant →"}</button>
      </div>
    </form>}
  </div>;
}
