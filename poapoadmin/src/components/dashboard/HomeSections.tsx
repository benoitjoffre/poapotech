import { Link } from "react-router-dom";
import type { DashboardExperience, DashboardSummary } from "@poapo/types";
import Icon from "../Icon";
import { DashboardPanel, ResourceLink } from "./DashboardCard";
import { quizPath } from "../../lib/experienceLinks";

export function HomeHero() {
  return <section className="home-hero" aria-labelledby="home-title">
    <div className="home-hero-copy">
      <span className="home-eyebrow">Bienvenue sur POAPO</span>
      <h1 id="home-title">Aidez vos clients à choisir les bons produits</h1>
      <p>Créez des expériences de recommandation personnalisées en quelques étapes.</p>
      <Link className="btn-primary" to="/quizzes/new"><Icon name="plus" />Créer une expérience</Link>
    </div>
    <div className="home-hero-visual" aria-hidden="true">
      <div className="home-visual-orbit" />
      <div className="home-visual-phone">
        <span className="home-visual-speaker" /><Icon name="sparkles" size={26} />
        <span className="home-visual-line" />
        {(["quiz", "box", "check"] as const).map((icon) => <div className="home-visual-option" key={icon}>
          <Icon name={icon} /><span />
        </div>)}
        <span className="home-visual-button" />
      </div>
      <div className="home-visual-result"><Icon name="box" size={28} /><span /><span /></div>
      <div className="home-visual-spark"><Icon name="sparkles" size={24} /></div>
    </div>
  </section>;
}

export function NextActionCard({ action, experience, hasExperiences }: {
  action: DashboardSummary["nextAction"];
  experience?: DashboardExperience;
  hasExperiences: boolean;
}) {
  return <DashboardPanel id="home-next-title" title="Votre prochaine action" icon="target" className="home-next">
    <div className="home-next-body">
      <h3>{action.kind === "draft" ? "Reprendre votre brouillon" : action.kind === "correction"
        ? "Compléter votre expérience" : hasExperiences ? "Créer une nouvelle expérience" : "Créer votre première expérience"}</h3>
      {experience ? <>
        <div className="home-next-experience"><span className="dashboard-icon"><Icon name="quiz" /></span>
          <div><strong>{experience.name}</strong><p className="dashboard-muted">Catalogue : {experience.catalog.name}</p></div>
        </div>
        <p className="dashboard-muted">{action.kind === "draft"
          ? "Votre brouillon est enregistré. Reprenez sa configuration sans modifier la version publique."
          : experience.correction}</p>
      </> : <p className="dashboard-muted">Choisissez vos produits et préparez les questions de votre quiz.</p>}
      <Link className="btn-primary" to={experience ? quizPath(experience) : "/quizzes/new"}>Continuer</Link>
    </div>
  </DashboardPanel>;
}

export function ProductsSummary({ products, catalogs }: Pick<DashboardSummary, "products" | "catalogs">) {
  return <DashboardPanel id="home-products-title" title="Mes produits" icon="box" className="home-products"
    action={<Link className="btn-ghost btn-sm" to="/catalog">Gérer mes produits →</Link>}>
    <div className="home-product-counts">
      <div><strong>{products.toLocaleString("fr-FR")}</strong><p>produit{products > 1 ? "s" : ""} dans vos catalogues</p></div>
      <div><strong>{catalogs.toLocaleString("fr-FR")}</strong><p>catalogue{catalogs > 1 ? "s" : ""} de votre boutique</p></div>
    </div>
    <div className="home-product-links"><Link to="/catalog/import">Importer des produits</Link>
      <Link to="/catalogs">Gérer les catalogues</Link>
      <Link to="/enrichment">Compléter les caractéristiques avec l'IA (facultatif)</Link></div>
  </DashboardPanel>;
}

export function HomeResources({ experience }: { experience?: DashboardExperience }) {
  return <div className="home-resources">
    <DashboardPanel id="home-tip-title" title="Un conseil pour démarrer" icon="bulb" className="home-tip">
      <p>Commencez par quelques produits et des questions simples. Vous pourrez enrichir votre expérience à votre rythme.</p>
      <Link to="/catalog">Préparer mes produits →</Link>
    </DashboardPanel>
    <DashboardPanel id="home-help-title" title="Pour bien démarrer" icon="book" className="home-guidance">
      <ResourceLink to="/quizzes/new" icon="plus" title="Créer sa première expérience" description="Ouvrir le parcours de création" />
      <ResourceLink to="/catalog/import" icon="box" title="Importer des produits" description="Depuis votre fichier CSV" />
      <ResourceLink to={experience ? quizPath(experience, "/quiz-builder") : "/quizzes/new"} icon="builder"
        title={experience ? "Personnaliser un quiz" : "Créer un quiz pour le personnaliser"} description="Préparer les questions et les réponses" />
      <ResourceLink to={experience ? quizPath(experience) : "/quizzes/new"} icon="copy"
        title={experience ? "Intégrer un quiz" : "Créer un quiz pour l'intégrer"} description="Accéder au lien et au code d'intégration" />
      {experience && <p className="dashboard-muted">Quiz sélectionné : {experience.name}. L'apparence et la publication restent dans l'éditeur de campagne.</p>}
    </DashboardPanel>
  </div>;
}
