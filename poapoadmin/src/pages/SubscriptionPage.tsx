import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SubscriptionFeatureKey, SubscriptionOverview, SubscriptionQuotaKey } from "@poapo/types";
import { apiFetch } from "../lib/api";
import "./subscription.css";

const QUOTAS: { key: SubscriptionQuotaKey; label: string; unit: string }[] = [
  { key: "catalogs", label: "Catalogues", unit: "catalogue" },
  { key: "publishedExperiences", label: "Expériences publiées", unit: "expérience" },
  { key: "recommendationsPerMonth", label: "Recommandations ce mois-ci", unit: "recommandation" },
];
const FEATURE_NOTES: Record<SubscriptionFeatureKey, string> = {
  aiEnrichment: "Complète automatiquement les caractéristiques de vos produits.",
  advancedAnalytics: "Entonnoir détaillé, abandons, variantes A/B et suggestions.",
  campaigns: "Planifiez des opérations autour de vos expériences.",
};
const STATUS_LABELS = { ACTIVE: "Actif", EXPIRED: "Accès offert expiré", CANCELED: "Annulé" } as const;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
const fmtLimit = (n: number | null) => (n === null ? "Illimité" : n.toLocaleString("fr-FR"));
const level = (used: number, limit: number | null) => (limit === null ? "ok" : used >= limit ? "full" : used / limit >= 0.8 ? "warn" : "ok");

export default function SubscriptionPage() {
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const [error, setError] = useState("");
  const [showPlans, setShowPlans] = useState(false);

  useEffect(() => {
    apiFetch<SubscriptionOverview>("/api/subscription").then(setData).catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="form-error" role="alert">{error}</div>;
  if (!data) return <div className="sub-page" aria-busy="true"><div className="sub-skeleton" /><div className="sub-skeleton" /></div>;

  const featureKeys = Object.keys(data.featureLabels) as SubscriptionFeatureKey[];
  // Seule la limite de recommandations impacte vos visiteurs : elle est signalée en alerte rouge ; les autres limites restent informatives (ambre).
  const recosFull = level(data.usage.recommendationsPerMonth, data.limits.recommendationsPerMonth) === "full";
  const lockedCount = featureKeys.filter((k) => !data.features[k]).length;

  return (
    <div className="sub-page">
      <div>
        <Link className="sub-back" to="/settings">← Paramètres</Link>
        <h1 className="page-title">Mon abonnement</h1>
      </div>

      <section className="sub-hero" aria-label="Formule actuelle">
        <div>
          <h2>Formule {data.planLabel}</h2>
          <p>
            {data.status === "ACTIVE" && data.endsAt ? `Accès offert jusqu'au ${fmtDate(data.endsAt)}.` : null}
            {data.status === "ACTIVE" && !data.endsAt ? (data.plan === "STARTER" ? "La formule gratuite pour démarrer." : "Sans date d'expiration.") : null}
            {data.status === "EXPIRED" ? "Vous êtes revenu sur la formule Starter." : null}
          </p>
          <div className="sub-badges">
            <span className={`sub-badge ${data.status === "ACTIVE" ? "sub-badge--ok" : "sub-badge--warn"}`}>{STATUS_LABELS[data.status]}</span>
            {data.promotional && <span className="sub-badge sub-badge--promo">Offert pendant le pilote</span>}
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setShowPlans(true); requestAnimationFrame(() => document.getElementById("sub-plans")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>
          Découvrir les formules
        </button>
      </section>

      {data.status === "EXPIRED" && (
        <div className="sub-notice" role="status">
          <strong>Votre accès offert{data.previousPlan ? ` à la formule ${data.previousPlan}` : ""} a pris fin{data.endsAt ? ` le ${fmtDate(data.endsAt)}` : ""}.</strong>
          Vos données sont conservées. Seules les nouvelles créations qui dépassent les limites Starter sont bloquées ; vos expériences en ligne continuent de fonctionner.
        </div>
      )}
      {recosFull && (
        <div className="sub-notice sub-notice--danger" role="status" data-testid="limits-reached">
          <strong>Quota mensuel de recommandations atteint</strong>
          Vos visiteurs ne reçoivent plus de recommandation jusqu'au {fmtDate(data.usagePeriod.resetsAt)}. Découvrez les formules pour aller plus loin.
        </div>
      )}

      <section className="sub-section" aria-labelledby="sub-usage">
        <h3 id="sub-usage">Consommation</h3>
        <p>Mise à jour à chaque visite de cette page.</p>
        <div className="sub-quotas">
          {QUOTAS.map(({ key, label, unit }) => {
            const limit = data.limits[key];
            const used = data.usage[key];
            const rawLvl = level(used, limit);
            const lvl = rawLvl === "full" && key !== "recommendationsPerMonth" ? "warn" : rawLvl;
            const left = limit === null ? null : Math.max(0, limit - used);
            return (
              <article key={key} className="sub-quota" data-testid={`quota-${key}`}>
                <span className="sub-quota-label">{label}</span>
                <span className="sub-quota-value">{used.toLocaleString("fr-FR")} / {fmtLimit(limit)}</span>
                {limit !== null && (
                  <div className={`sub-bar is-${lvl}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
                    <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
                  </div>
                )}
                <span className={`sub-quota-note${lvl === "full" ? " is-full" : lvl === "warn" ? " is-warn" : ""}`}>
                  {limit === null
                    ? "Pas de limite sur votre formule, la consommation reste suivie."
                    : rawLvl === "full" ? "— limite atteinte"
                    : `${left!.toLocaleString("fr-FR")} ${unit}${left! > 1 ? "s" : ""} restante${left! > 1 ? "s" : ""}`}
                  {key === "recommendationsPerMonth" && ` · remise à zéro le ${fmtDate(data.usagePeriod.resetsAt)}`}
                </span>
              </article>
            );
          })}
        </div>
        <p className="sub-plans-note">Un rafraîchissement ou un nouvel essai d'un même visiteur ne compte qu'une seule recommandation.</p>
      </section>

      <section className="sub-section" aria-labelledby="sub-features">
        <h3 id="sub-features">Fonctionnalités</h3>
        <p>{lockedCount === 0 ? "Toutes les fonctionnalités sont incluses dans votre formule." : `${lockedCount} fonctionnalité${lockedCount > 1 ? "s" : ""} non incluse${lockedCount > 1 ? "s" : ""} dans votre formule.`}</p>
        <ul className="sub-features">
          {featureKeys.map((key) => {
            const on = data.features[key];
            return (
              <li key={key} className={`sub-feature${on ? "" : " is-locked"}`} data-testid={`feature-${key}`}>
                <span className="sub-feature-icon" aria-hidden="true">{on ? "✓" : "—"}</span>
                <span>
                  <span className="sub-feature-title">{on ? "✓ " : ""}{data.featureLabels[key]}</span>
                  <span className="sub-feature-note" style={{ display: "block" }}>{on ? FEATURE_NOTES[key] : "Fonctionnalité non incluse dans votre formule."}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {showPlans && (
        <section className="sub-section" id="sub-plans" data-testid="plans" aria-labelledby="sub-plans-title">
          <div className="sub-plans-head">
            <h3 id="sub-plans-title">Les formules</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowPlans(false)}>Masquer</button>
          </div>
          <p>Comparez les limites et les fonctionnalités de chaque formule.</p>
          <div className="sub-plans">
            {data.plans.map((p) => (
              <article key={p.id} className={`sub-plan${p.id === data.plan ? " is-current" : ""}`}>
                <h4>{p.label}{p.id === data.plan && <span className="sub-badge sub-badge--promo">Formule actuelle</span>}</h4>
                <ul>
                  {QUOTAS.map(({ key, label }) => (
                    <li key={key}>{label.replace(" ce mois-ci", " / mois")} : {fmtLimit(p.limits[key])}</li>
                  ))}
                </ul>
                <div className="sub-plan-sep" />
                <ul>
                  {featureKeys.map((f) => <li key={f} className={p.features[f] ? "" : "is-off"}>{data.featureLabels[f]}</li>)}
                </ul>
              </article>
            ))}
          </div>
          <p className="sub-plans-note">Les tarifs ne sont pas encore définis. Pendant le pilote, la formule Pro peut vous être offerte : parlez-en à l'équipe POAPO.</p>
        </section>
      )}
    </div>
  );
}
