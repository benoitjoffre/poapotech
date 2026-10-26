import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { HELP_ARTICLES, findArticle } from "../lib/help";
import "./help.css";

export default function HelpArticlePage() {
  const { slug } = useParams();
  const article = findArticle(slug);
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  const back = <Link className="table-link" to="/help">← Retour au Centre d'aide</Link>;
  if (!article) return <div className="page help-page">
    {back}
    <h1 className="page-title">Article introuvable</h1>
    <p className="help-muted">Ce guide n'existe pas. Retrouvez tous les guides dans le Centre d'aide.</p>
  </div>;

  const next = HELP_ARTICLES[HELP_ARTICLES.findIndex((a) => a.slug === article.slug) + 1];
  const prev = HELP_ARTICLES[HELP_ARTICLES.findIndex((a) => a.slug === article.slug) - 1];

  return <div className="page help-page help-article">
    {back}
    <header>
      <p className="help-eyebrow">Guide {article.number} sur {HELP_ARTICLES.length} · {article.minutes} min</p>
      <h1 className="page-title">{article.title}</h1>
      <p className="help-lead">{article.intro}</p>
    </header>

    {article.sections?.map((s) => <section key={s.title} className="help-block">
      <h2 className="help-h2">{s.title}</h2>
      {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
      {s.items && <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </section>)}

    <section className="help-block" aria-labelledby="help-steps">
      <h2 id="help-steps" className="help-h2">Pas à pas</h2>
      <ol className="help-steps">
        {article.steps.map((s) => <li key={s.title}>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
          {s.link && <Link className="btn-ghost btn-sm" to={s.link.to}>{s.link.label} →</Link>}
        </li>)}
      </ol>
    </section>

    <aside className="help-tip" aria-labelledby="help-tip-title">
      <h2 id="help-tip-title" className="help-h2">Bon à savoir</h2>
      <ul>{article.tips.map((t) => <li key={t}>{t}</li>)}</ul>
    </aside>

    <nav className="help-pager" aria-label="Navigation entre les guides">
      {prev ? <Link to={`/help/${prev.slug}`}>← {prev.title}</Link> : <span />}
      {next ? <Link className="btn-primary" to={`/help/${next.slug}`}>Guide suivant : {next.title} →</Link>
        : <Link className="btn-primary" to="/help">Retour au Centre d'aide</Link>}
    </nav>
  </div>;
}
