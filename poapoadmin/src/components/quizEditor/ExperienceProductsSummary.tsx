import { Link } from "react-router-dom";
import type { QuizAxis } from "@poapo/types";
import type { CatalogProduct, QuizConfigForm } from "./QuizConfigFields";

function hasAxisValue(product: CatalogProduct, key: string): boolean {
  const value = product.attributes?.[key];
  return typeof value === "number" && Number.isFinite(value);
}

/** Produits que le quiz peut recommander avec la configuration locale courante. */
export function recommendableProducts(form: Pick<QuizConfigForm, "useAllProducts" | "productIds">, products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) => product.active && (form.useAllProducts || form.productIds.includes(product.id)));
}

export function scoringCoverage(products: CatalogProduct[], axes: QuizAxis[]) {
  return {
    complete: axes.length === 0 ? 0 : products.filter((product) => axes.every((axis) => hasAxisValue(product, axis.key))).length,
    perAxis: axes.map((axis) => ({ axis, count: products.filter((product) => hasAxisValue(product, axis.key)).length })),
  };
}

export default function ExperienceProductsSummary({ form, catalogName, catalogId, products, loading, error }: {
  form: QuizConfigForm; catalogName: string; catalogId: string; products: CatalogProduct[]; loading: boolean; error: string;
}) {
  const recommendable = recommendableProducts(form, products);
  const coverage = scoringCoverage(recommendable, form.axes);
  const catalogQuery = catalogId ? `?catalogId=${encodeURIComponent(catalogId)}` : "";
  return <section className="form-section xe-products" aria-labelledby="xe-products-title">
    <h2 className="section-title" id="xe-products-title" tabIndex={-1}>Catalogue et produits</h2>
    <div className="xe-warning" role="note">
      <strong>Les produits ne sont pas protégés par le brouillon.</strong> Modifier, importer ou enrichir une fiche produit s'applique
      immédiatement aux recommandations publiques de tous les quiz qui utilisent ce catalogue. Seule la sélection de produits
      ci-dessous fait partie du brouillon.
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <dl className="xe-facts">
      <div><dt>Catalogue associé</dt><dd>{catalogName}</dd></div>
      <div><dt>Mode</dt><dd>{form.useAllProducts ? "Tous les produits actifs" : `Sélection manuelle (${form.productIds.length})`}</dd></div>
      <div><dt>Produits recommandables</dt><dd>{loading ? "Chargement…" : `${recommendable.length} sur ${products.length} dans le catalogue`}</dd></div>
      <div><dt>Prêts pour le scoring</dt><dd>{loading ? "Chargement…" : form.axes.length === 0 ? "Aucun axe défini" :
        `${coverage.complete} sur ${recommendable.length} avec tous les axes renseignés`}</dd></div>
    </dl>
    {!loading && form.axes.length > 0 && recommendable.length > 0 && <ul className="xe-coverage" aria-label="Couverture des axes">
      {coverage.perAxis.map(({ axis, count }) => <li key={axis.key}>
        <span>{axis.label || axis.key}</span>
        <span className={count < recommendable.length ? "xe-low" : ""}>{count} / {recommendable.length}</span>
      </li>)}
    </ul>}
    {!loading && recommendable.length === 0 && <p className="form-error">Aucun produit recommandable avec cette configuration.</p>}
    <p className="xe-tools">
      <Link className="btn-ghost btn-sm" to={`/catalog${catalogQuery}`}>Gérer les produits</Link>
      <Link className="btn-ghost btn-sm" to={`/catalog/import${catalogQuery}`}>Importer des produits</Link>
      <Link className="btn-ghost btn-sm" to={`/enrichment${catalogQuery}`}>Enrichir les axes</Link>
    </p>
  </section>;
}
