import { useEffect, useState } from "react";
import type { PaginatedResponse, TenantAdminCreateInput, TenantAdminItem, TenantAdminUpdateInput } from "@poapo/types";
import { apiFetch } from "../lib/api";

const PAGE_SIZE = 20;

export default function TenantsAdminPage() {
  const [data, setData] = useState<TenantAdminItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await apiFetch<PaginatedResponse<TenantAdminItem>>(`/api/admin/tenants?${params.toString()}`);
      setData(res.data);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const createTenant = async () => {
    if (!newEmail.trim()) return;
    setCreating(true);
    try {
      const payload: TenantAdminCreateInput = {
        email: newEmail.trim(),
        name: newName.trim() || undefined,
        password: newPassword.trim() || undefined,
      };
      await apiFetch<TenantAdminItem>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (tenant: TenantAdminItem) => {
    try {
      const payload: TenantAdminUpdateInput = { active: !tenant.active };
      const updated = await apiFetch<TenantAdminItem>(`/api/admin/tenants/${tenant.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setData((prev) => prev.map((t) => (t.id === tenant.id ? updated : t)));
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const updateName = async (tenant: TenantAdminItem) => {
    const next = prompt("Nouveau nom", tenant.name ?? "");
    if (next === null) return;
    try {
      const payload: TenantAdminUpdateInput = { name: next };
      const updated = await apiFetch<TenantAdminItem>(`/api/admin/tenants/${tenant.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setData((prev) => prev.map((t) => (t.id === tenant.id ? updated : t)));
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const resetPassword = async (tenant: TenantAdminItem) => {
    const pwd = prompt(`Nouveau mot de passe pour ${tenant.email}`);
    if (!pwd) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/admin/tenants/${tenant.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: pwd }),
      });
      alert("Mot de passe mis à jour");
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Administration des tenants</h1>
          <p className="page-subtitle">
            {total} tenant{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <section className="form-section">
        <h2 className="section-title">Créer un tenant</h2>
        <div className="form-grid">
          <div className="field-group">
            <label className="field-label">Email *</label>
            <input className="field-input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="owner@marque.com" />
          </div>
          <div className="field-group">
            <label className="field-label">Nom</label>
            <input className="field-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la marque" />
          </div>
          <div className="field-group field-span2">
            <label className="field-label">Mot de passe initial (optionnel)</label>
            <input className="field-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="8 caractères min" />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn-primary" disabled={creating || !newEmail.trim()} onClick={() => void createTenant()}>
            {creating ? "Création..." : "Créer le tenant"}
          </button>
        </div>
      </section>

      <section className="form-section">
        <div className="form-actions" style={{ justifyContent: "space-between", paddingTop: 0 }}>
          <input
            className="field-input"
            placeholder="Rechercher email ou nom"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            style={{ maxWidth: 320 }}
          />
          <div className="text-muted">
            Page {page}/{totalPages}
          </div>
        </div>

        {loading && <div className="loading-block">Chargement...</div>}
        {error && <div className="form-error">{error}</div>}

        {!loading && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nom</th>
                  <th>Statut</th>
                  <th>Créé le</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>{tenant.email}</td>
                    <td>{tenant.name ?? "-"}</td>
                    <td>
                      <span className={`badge ${tenant.active ? "badge-active" : "badge-inactive"}`}>{tenant.active ? "Actif" : "Inactif"}</span>
                    </td>
                    <td>{new Date(tenant.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td>
                      <div className="table-actions">
                        <button type="button" className="btn-ghost" onClick={() => void updateName(tenant)}>
                          Renommer
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => void toggleActive(tenant)}>
                          {tenant.active ? "Désactiver" : "Activer"}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => void resetPassword(tenant)}>
                          Reset MDP
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      Aucun tenant
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Précédent
          </button>
          <button type="button" className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Suivant
          </button>
        </div>
      </section>
    </div>
  );
}
