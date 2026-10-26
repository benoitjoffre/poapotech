import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_FAQ, searchArticles, searchFaq } from "../lib/help";
import "./help.css";

export default function HelpCenterPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const searching = query.trim().length > 0;
  const articles = searchArticles(query);
  const faqs = searching ? searchFaq(query) : HELP_FAQ;
  const setQuery = (value: string) => setParams(value ? { q: value } : {}, { replace: true });

  return <div className="page help-page">
    <section className="help-hero">
      <h1 className="page-title">Centre d'aide</h1>
      <p>Tout ce qu'il vous faut pour créer des expériences de recommandation qui plaisent à vos clients.</p>
      <form className="help-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <label className="help-sr" htmlFor="help-search">Rechercher un article, un mot-clé</label>
        <input id="help-search" type="search" value={query} placeholder="Rechercher un article, un mot-clé…"
          onChange={(e) => setQuery(e.target.value)} />
      </form>
      <ul className="help-chips" aria-label="Catégories">
        {HELP_CATEGORIES.map((c) => <li key={c}>
          <button type="button" className={`help-chip${query === c ? " active" : ""}`} aria-pressed={query === c}
            onClick={() => setQuery(query === c ? "" : c)}>{c}</button>
        </li>)}
      </ul>
    </section>

    <section aria-labelledby="help-guides">
      <h2 id="help-guides" className="help-h2">{searching ? "Résultats de la recherche" : "Guides d'utilisation"}</h2>
      {searching
        ? <p className="help-muted" role="status">{articles.length} guide{articles.length > 1 ? "s" : ""} et {faqs.length} question{faqs.length > 1 ? "s" : ""} pour « {query} ».</p>
        : <p className="help-muted">Découvrez les étapes pour tirer le meilleur parti de POAPO.</p>}
      {articles.length === 0 && faqs.length === 0 && <p className="help-empty">Aucun résultat. Essayez un autre mot-clé ou <button type="button" className="table-link" onClick={() => setQuery("")}>affichez tous les guides</button>.</p>}
      <ul className="help-grid">
        {articles.map((a) => <li key={a.slug}>
          <Link className="help-card" to={`/help/${a.slug}`}>
            <span className="help-card-icon"><Icon name={a.icon} size={22} /></span>
            <span className="help-card-body">
              <strong>{a.number}. {a.title}</strong>
              <span>{a.summary}</span>
              <span className="help-muted">{a.minutes} min</span>
            </span>
          </Link>
        </li>)}
      </ul>
    </section>

    {!searching && <section aria-labelledby="help-start">
      <h2 id="help-start" className="help-h2">Par où commencer ?</h2>
      <p className="help-muted">Si vous découvrez POAPO, suivez ces étapes dans l'ordre.</p>
      <ol className="help-start">
        {HELP_ARTICLES.map((a) => <li key={a.slug}>
          <Link to={`/help/${a.slug}`}><span className="help-num" aria-hidden="true">{a.number}</span>
            <span><strong>{a.title}</strong><span className="help-muted">{a.summary}</span></span></Link>
        </li>)}
      </ol>
    </section>}

    {faqs.length > 0 && <section aria-labelledby="help-faq">
      <h2 id="help-faq" className="help-h2">Questions fréquentes</h2>
      <div className="help-faq">
        {faqs.map((f) => <details key={f.question}>
          <summary>{f.question}</summary>
          <p>{f.answer}{f.slug && <> <Link to={`/help/${f.slug}`}>Lire le guide</Link></>}</p>
        </details>)}
      </div>
    </section>}
  </div>;
}
