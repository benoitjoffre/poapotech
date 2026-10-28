import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { SubscriptionOverview, SubscriptionQuotaKey } from "@poapo/types";
import { apiFetch } from "../lib/api";

const ROWS: { key: SubscriptionQuotaKey; label: string }[] = [
  { key: "catalogs", label: "Catalogues" },
  { key: "publishedExperiences", label: "Expériences" },
  { key: "recommendationsPerMonth", label: "Recos / mois" },
];

/** Formule et consommation toujours visibles dans le menu (mis à jour à chaque navigation). */
export default function SidebarPlan() {
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    apiFetch<SubscriptionOverview>("/api/subscription").then((d) => { if (!cancelled) setData(d); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [pathname]);

  if (!data) return null;
  return (
    <Link to="/settings/subscription" className="sidebar-plan" data-testid="sidebar-plan" aria-label={`Formule ${data.planLabel} : voir mon abonnement`}>
      <span className="sidebar-plan-title">Formule {data.planLabel}{data.promotional ? " · offert" : ""}</span>
      {ROWS.map(({ key, label }) => {
        const limit = data.limits[key];
        const used = data.usage[key];
        const full = limit !== null && used >= limit;
        return (
          <span key={key} className={`sidebar-plan-row${full ? (key === "recommendationsPerMonth" ? " is-full is-critical" : " is-full") : ""}`} data-testid={`sidebar-plan-${key}`}>
            <span>{label}</span>
            <span>{used.toLocaleString("fr-FR")} / {limit === null ? "∞" : limit.toLocaleString("fr-FR")}</span>
          </span>
        );
      })}
    </Link>
  );
}
