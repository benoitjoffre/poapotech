import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Campaign, CampaignListResponse, CampaignOccasion, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";
import { useCatalogSelection } from "../lib/catalogs";
import Icon from "../components/Icon";
import { CampaignImage } from "../components/CampaignVisuals";
import { useExperiencesOverview } from "../hooks/useExperiencesOverview";
import { DIFFUSION_NOTE, canDeleteCampaign, quizAccess } from "../lib/campaignExperience";
import { experienceEditorPath } from "../lib/experienceLinks";
import "./campaigns.css";
import {
  formatPeriod,
  occasionName,
  OCCASIONS,
  STATUS_LABELS,
} from "../lib/campaigns";

type Tab = "ALL" | CampaignStatus;
type Sort = "recent" | "oldest" | "startsAt" | "name";

const TABS: { key: Tab; label: string }[] = [
  { key: "ALL", label: "Toutes" },
  { key: "ACTIVE", label: "En cours" },
  { key: "SCHEDULED", label: "Programmées" },
  { key: "DRAFT", label: "Brouillons" },
  { key: "PAUSED", label: "En pause" },
  { key: "COMPLETED", label: "Terminées" },
];

const SORT_LABELS: Record<Sort, string> = {
  recent: "Plus récentes",
  oldest: "Plus anciennes",
  startsAt: "Date de début",
  name: "Nom (A → Z)",
};

const EMPTY_COUNTS: CampaignListResponse["counts"] = { total: 0, DRAFT: 0, SCHEDULED: 0, ACTIVE: 0, PAUSED: 0, COMPLETED: 0 };

export default function CampaignsPage() {
  const { quizzes } = useQuiz();
  const { overview } = useExperiencesOverview();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [occasion, setOccasion] = useState<CampaignOccasion | "">("");
  const [quizId, setQuizId] = useState("");
  const { catalogs, catalogId, setCatalogId, loading: catalogsLoading } = useCatalogSelection({ allowAll: true });
  const catalogQuizzes = catalogId ? quizzes.filter((quiz) => quiz.catalogId === catalogId) : quizzes;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ sort });
    if (tab !== "ALL") params.set("status", tab);
    if (search) params.set("search", search);
    if (occasion) params.set("occasion", occasion);
    if (quizId) params.set("quizId", quizId);
    if (catalogId) params.set("catalogId", catalogId);
    try {
      const result = await apiFetch<CampaignListResponse>(`/api/campaigns?${params}`);
      if (current !== requestId.current) return;
      setCampaigns(result.data);
      setCounts(result.counts);
    } catch (err) {
      if (current === requestId.current) setError((err as Error).message);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [tab, search, sort, occasion, quizId, catalogId]);

  useEffect(() => {
    if (!catalogsLoading) void load();
  }, [load, catalogsLoading]);

  const runAction = async (campaign: Campaign, action: () => Promise<unknown>) => {
    setBusyId(campaign.id);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = (campaign: Campaign) =>
    runAction(campaign, () => apiFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/duplicate`, { method: "POST" }));

  const remove = (campaign: Campaign) => {
    if (!window.confirm(`Supprimer le brouillon « ${campaign.name} » ? Cette action est définitive.`)) return;
    void runAction(campaign, () => apiFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, { method: "DELETE" }));
  };

  const hasFilters = !!(search || occasion || quizId || catalogId || tab !== "ALL");
  const shopActive = overview?.shopActive ?? null;
  const resetFilters = () => { setTab("ALL"); setSearchInput(""); setSearch(""); setOccasion(""); setQuizId(""); setCatalogId(""); };

  return (
    <div className="page campaigns-page cp">
      <div className="page-header">
        <div>
          <h1 className="page-title campaigns-title">Campagnes</h1>
          <p className="page-subtitle">Organisez vos temps forts commerciaux autour de vos expériences de recommandation.</p>
        </div>
        <Link className="btn-primary btn-lg" to="/campaigns/new"><Icon name="plus" />Créer une campagne</Link>
      </div>

      <aside className="cp-note" aria-label="Campagne et expérience">
        <p><strong>Campagne ≠ expérience.</strong> L'expérience est le quiz de recommandation ; la campagne est une opération marketing qui l'utilise.</p>
        <p>{DIFFUSION_NOTE}</p>
      </aside>

      <div className="cp-toolbar">
        <div className="cp-search">
          <label className="sr-only" htmlFor="cp-search">Rechercher une campagne</label>
          <input id="cp-search" className="field-input" type="search" placeholder="Rechercher par nom…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="cp-sort">Trier</label>
        <select id="cp-sort" className="field-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {(Object.keys(SORT_LABELS) as Sort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
        </select>
        <label className="sr-only" htmlFor="cp-occasion">Occasion</label>
        <select id="cp-occasion" className="field-select" value={occasion} onChange={(e) => setOccasion(e.target.value as CampaignOccasion | "")}>
          <option value="">Toutes les occasions</option>
          {OCCASIONS.map((value) => <option key={value} value={value}>{occasionName({ occasion: value, occasionLabel: null })}</option>)}
        </select>
        {catalogs.length > 1 && <>
          <label className="sr-only" htmlFor="cp-catalog">Catalogue</label>
          <select id="cp-catalog" className="field-select" value={catalogId} onChange={(e) => { setCatalogId(e.target.value); if (quizId) setQuizId(""); }}>
            <option value="">Tous les catalogues</option>
            {catalogs.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name}</option>)}
          </select>
        </>}
        <label className="sr-only" htmlFor="cp-quiz">Expérience</label>
        <select id="cp-quiz" className="field-select" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
          <option value="">Toutes les expériences</option>
          {catalogQuizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.name}</option>)}
        </select>
      </div>

      <div className="cp-tabs" role="group" aria-label="Filtrer par statut">
        {TABS.map((item) => {
          const count = item.key === "ALL" ? counts.total : counts[item.key];
          return (
            <button key={item.key} type="button" className={`cp-tab${tab === item.key ? " active" : ""}`} aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}>
              {item.label} <span className="cp-count">{count}</span>
            </button>
          );
        })}
      </div>

      {error && <div className="error-banner" role="alert">{error} <button type="button" className="btn-link" onClick={() => void load()}>Réessayer</button></div>}

      {loading && campaigns.length === 0 ? (
        <p className="cp-muted" role="status">Chargement des campagnes…</p>
      ) : campaigns.length === 0 && !error ? (
        <div className="cp-empty">
          {hasFilters ? <>
            <h2>Aucune campagne ne correspond</h2>
            <p>Modifiez vos filtres ou votre recherche.</p>
            <button type="button" className="btn-ghost" onClick={resetFilters}>Réinitialiser les filtres</button>
          </> : <>
            <h2>Aucune campagne pour le moment</h2>
            <p>Une campagne relie une occasion commerciale et des dates à l'une de vos expériences. Elle est facultative : vos expériences fonctionnent sans.</p>
            <Link className="btn-primary" to="/campaigns/new">Créer une campagne</Link>
          </>}
        </div>
      ) : (
        <ul className="cp-list" aria-busy={loading}>
          {campaigns.map((campaign) => {
            const access = quizAccess(shopActive, campaign.quiz.active);
            const busy = busyId === campaign.id;
            const menuOpen = openMenu === campaign.id;
            return (
              <li key={campaign.id} className="cp-card">
                <div className="cp-card-visual"><CampaignImage campaign={campaign} /></div>
                <div className="cp-card-main">
                  <div className="cp-card-head">
                    <h2 className="cp-card-title"><Link to={`/campaigns/${campaign.id}`}>{campaign.name}</Link></h2>
                    <span className={`xp-badge cp-status ${campaign.effectiveStatus.toLowerCase()}`}>Campagne : {STATUS_LABELS[campaign.effectiveStatus]}</span>
                  </div>
                  <p className="cp-meta">{occasionName(campaign)} · {formatPeriod(campaign)}</p>
                  <p className="cp-meta">
                    Expérience : <Link className="table-link" to={experienceEditorPath(campaign.quiz.id)}>{campaign.quiz.name}</Link>
                    {" · "}{campaign.quiz.catalog.name}
                  </p>
                  <div className="xp-badges">
                    {access
                      ? <span className={`xp-badge ${access.accessible ? "public" : "inactive"}`}>Quiz : {access.label}</span>
                      : <span className="xp-badge neutral">Quiz : actif</span>}
                  </div>
                </div>
                <div className="cp-card-actions">
                  <Link className="btn-primary" to={`/campaigns/${campaign.id}`}>Ouvrir</Link>
                  <div className="cp-menu">
                    <button type="button" className="btn-ghost" aria-haspopup="true" aria-expanded={menuOpen} disabled={busy}
                      aria-label={`Autres actions pour ${campaign.name}`} onClick={() => setOpenMenu(menuOpen ? null : campaign.id)}
                      onKeyDown={(e) => { if (e.key === "Escape") setOpenMenu(null); }}>⋯</button>
                    {menuOpen && (
                      <div className="cp-menu-list" role="group" aria-label="Actions" onKeyDown={(e) => { if (e.key === "Escape") setOpenMenu(null); }}>
                        <Link className="cp-menu-item" to={`/campaigns/${campaign.id}/edit`}>Modifier</Link>
                        <button type="button" className="cp-menu-item" onClick={() => { setOpenMenu(null); void duplicate(campaign); }}>Dupliquer</button>
                        {canDeleteCampaign(campaign.status) &&
                          <button type="button" className="cp-menu-item danger" onClick={() => { setOpenMenu(null); remove(campaign); }}>Supprimer le brouillon</button>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
