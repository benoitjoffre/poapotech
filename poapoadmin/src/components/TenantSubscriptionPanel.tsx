import { useEffect, useState } from "react";
import type { SubscriptionOverview, SubscriptionPlanId } from "@poapo/types";
import { apiFetch } from "../lib/api";

interface PlanEvent {
  id: string; actor: string; action: string; fromPlan: SubscriptionPlanId | null; toPlan: SubscriptionPlanId;
  toSource: string; endsAt: string | null; createdAt: string;
}
interface Payload { subscription: SubscriptionOverview; events: PlanEvent[] }

const STATUS = { ACTIVE: "Actif", EXPIRED: "Offre expirée (retour Starter)", CANCELED: "Annulé" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR") : "—");

/** Super-admin : plan effectif, attribution (STARTER / PRO / BUSINESS, échéance facultative) et historique. */
export default function TenantSubscriptionPanel({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlanId>("PRO");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const url = `/api/admin/tenants/${encodeURIComponent(tenantId)}/subscription`;

  useEffect(() => {
    apiFetch<Payload>(url).then(setData).catch((err: Error) => setError(err.message));
  }, [url]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // La date est choisie en jour local : l'accès court jusqu'à la fin de ce jour.
      const end = plan !== "STARTER" && endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null;
      setData(await apiFetch<Payload>(url, { method: "PUT", body: JSON.stringify({ plan, endsAt: end }) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <p className="section-hint">{error || "Chargement…"}</p>;
  const sub = data.subscription;
  return (
    <div data-testid="tenant-subscription" className="form-section">
      <p>
        Plan actuel : <strong data-testid="tenant-plan">{sub.planLabel}</strong> — {STATUS[sub.status]}
        {sub.promotional && " — offert"}{sub.source === "LEGACY" && " — pilote (LEGACY)"}
        {sub.endsAt && ` — jusqu'au ${fmt(sub.endsAt)}`}
      </p>
      <div className="table-actions">
        <label>Plan{" "}
          <select aria-label="Plan à attribuer" value={plan} onChange={(e) => setPlan(e.target.value as SubscriptionPlanId)}>
            <option value="STARTER">Starter</option><option value="PRO">Pro</option><option value="BUSINESS">Business</option>
          </select>
        </label>
        <label>Expire le (facultatif){" "}
          <input aria-label="Date d'expiration" type="date" value={endsAt} disabled={plan === "STARTER"}
            min={new Date().toISOString().slice(0, 10)} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>Attribuer</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <h3 className="section-title">Historique</h3>
      <ul data-testid="tenant-history">
        {data.events.map((e) => (
          <li key={e.id}>{fmt(e.createdAt)} — {e.actor} : {e.fromPlan ?? "∅"} → {e.toPlan} ({e.toSource}){e.endsAt ? `, jusqu'au ${fmt(e.endsAt)}` : ""}</li>
        ))}
      </ul>
    </div>
  );
}
