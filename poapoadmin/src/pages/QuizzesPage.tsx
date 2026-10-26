import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ExperiencesOverview } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { CatalogSelect, useCatalogSelection } from "../lib/catalogs";
import {
  filterExperiences, sortExperiences, totalsOf,
  type AvailabilityFilter, type DraftFilter, type ExperienceSort,
} from "../lib/experiences";
import Icon from "../components/Icon";
import { StatCard } from "../components/dashboard/DashboardCard";
import ExperienceCard from "../components/experiences/ExperienceCard";
import ExperienceDetails from "../components/experiences/ExperienceDetails";
import "../components/experiences/experiences.css";

function Chips<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return <div className="xp-chips" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value}
      className={`xp-chip${value === option.value ? " active" : ""}`} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export default function QuizzesPage() {
  const { user } = useAuth();
  const { catalogs, catalogId, setCatalogId } = useCatalogSelection({ allowAll: true });
  const [params, setParams] = useSearchParams();
  const [overview, setOverview] = useState<ExperiencesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [draft, setDraft] = useState<DraftFilter>("all");
  const [sort, setSort] = useState<ExperienceSort>("recent");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<ExperiencesOverview>("/api/experiences")
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger vos expériences."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const all = useMemo(() => overview?.experiences ?? [], [overview]);
  const inCatalog = useMemo(() => filterExperiences(all, { query: "", availability: "all", draft: "all", catalogId }), [all, catalogId]);
  const visible = useMemo(() => sortExperiences(
    filterExperiences(all, { query, availability, draft, catalogId }), sort), [all, query, availability, draft, catalogId, sort]);
  const totals = useMemo(() => totalsOf(all), [all]);
  const days = overview?.period.days ?? 30;

  const requested = params.get("experience");
  const selected = visible.find((item) => item.id === requested) ?? null;
  const shown = selected ?? visible[0] ?? null;
  const select = (id: string | null) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    if (id) next.set("experience", id); else next.delete("experience");
    return next;
  }, { replace: true });
  const createPath = catalogId ? `/experiences/new?catalogId=${encodeURIComponent(catalogId)}` : "/experiences/new";
  const count = (predicate: (item: (typeof all)[number]) => boolean) => inCatalog.filter(predicate).length;
  const filtered = !!query || availability !== "all" || draft !== "all";

  return <div className="page experiences-page">
    <header className="page-header">
      <div>
        <h1 className="page-title">Mes expériences</h1>
        <p className="page-subtitle">Créez, modifiez et publiez vos quiz de recommandation. Une expérience est un quiz unique qui peut être utilisé dans plusieurs campagnes, ou sans campagne.</p>
      </div>
      <Link className="btn-primary" to={createPath}><Icon name="plus" size={16} />&nbsp;Créer une expérience</Link>
    </header>

    {loading && <div className="loading-block" role="status">Chargement de vos expériences…</div>}
    {error && <div className="xp-state"><p className="form-error" role="alert">{error}</p>
      <button type="button" className="btn-ghost" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button></div>}

    {!loading && !error && overview && (all.length === 0 ? <div className="xp-state xp-empty">
      <h2>Vous n'avez pas encore d'expérience</h2>
      <p>Une expérience guide vos clients vers les produits d'un catalogue grâce à quelques questions. Aucune campagne n'est nécessaire pour commencer.</p>
      <Link className="btn-primary" to={createPath}>Créer ma première expérience</Link>
    </div> : <>
      <div className="xp-kpis">
        <StatCard label="Expériences" value={all.length} icon="sparkles" caption="Tous catalogues" />
        <StatCard label="Accessibles au public" value={totals.accessible} icon="eye" caption="Disponibilité actuelle" />
        <StatCard label="Quiz commencés" value={totals.started} icon="quiz" caption={`Ces ${days} derniers jours`} />
        <StatCard label="Quiz terminés" value={totals.completed} icon="check" caption={`Ces ${days} derniers jours`} />
      </div>

      <div className="xp-toolbar" role="search">
        <div className="field-group xp-search">
          <label className="field-label" htmlFor="xp-search">Rechercher par nom</label>
          <input id="xp-search" className="field-input" type="search" value={query} placeholder="Rechercher une expérience…"
            onChange={(event) => setQuery(event.target.value)} />
        </div>
        <CatalogSelect catalogs={catalogs} value={catalogId} onChange={setCatalogId} allowAll />
        <div className="field-group">
          <label className="field-label" htmlFor="xp-sort">Trier par</label>
          <select id="xp-sort" className="field-select" value={sort} onChange={(event) => setSort(event.target.value as ExperienceSort)}>
            <option value="recent">Dernière modification</option>
            <option value="name">Nom</option>
          </select>
        </div>
      </div>
      <div className="xp-filters">
        <Chips label="Disponibilité publique" value={availability} onChange={setAvailability} options={[
          { value: "all", label: `Toutes (${inCatalog.length})` },
          { value: "accessible", label: `Accessibles (${count((item) => item.accessible)})` },
          { value: "inactive", label: `Désactivées (${count((item) => !item.accessible)})` },
        ]} />
        <Chips label="Brouillon" value={draft} onChange={setDraft} options={[
          { value: "all", label: "Tous les états" },
          { value: "with", label: `Avec brouillon (${count((item) => item.hasDraft)})` },
          { value: "without", label: `Sans brouillon (${count((item) => !item.hasDraft)})` },
        ]} />
      </div>
      <p className="xp-muted" role="status" aria-live="polite">{visible.length} expérience{visible.length > 1 ? "s" : ""} affichée{visible.length > 1 ? "s" : ""}</p>

      <div className={`xp-layout${selected ? " has-selection" : ""}`}>
        <section className="xp-list" aria-label="Liste des expériences">
          {visible.length === 0 ? <div className="xp-state">
            <p>{filtered || catalogId ? "Aucune expérience ne correspond à ces critères." : "Aucune expérience."}</p>
            {(filtered || catalogId) && <button type="button" className="btn-ghost" onClick={() => {
              setQuery(""); setAvailability("all"); setDraft("all"); setCatalogId("");
            }}>Réinitialiser les filtres</button>}
          </div> : visible.map((item) => <ExperienceCard key={item.id} experience={item} selected={shown?.id === item.id}
            onSelect={() => select(item.id)} tenantId={user?.tenantId} days={days} shopActive={overview.shopActive} />)}
        </section>
        {shown && <ExperienceDetails key={shown.id} experience={shown} tenantId={user?.tenantId} days={days} shopActive={overview.shopActive} onClose={() => select(null)} />}
      </div>
    </>)}
  </div>;
}
