import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Campaign, CampaignListResponse, CampaignOccasion, CampaignStatus } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useQuiz } from "../contexts/QuizContext";
import { useCatalogSelection } from "../lib/catalogs";
import Icon from "../components/Icon";
import { CampaignImage, CampaignStatusToggle } from "../components/CampaignVisuals";
import {
  CAMPAIGN_TEMPLATES,
  formatPeriod,
  occasionName,
  OCCASION_LABELS,
  OCCASIONS,
  startsIn,
  STATUS_LABELS,
} from "../lib/campaigns";

type Tab = "ALL" | CampaignStatus;
type Sort = "recent" | "oldest" | "startsAt" | "name";

const TABS: { key: Tab; label: string }[] = [
  { key: "ALL", label: "Toutes" },
  { key: "ACTIVE", label: "En ligne" },
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
  const navigate = useNavigate();
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

  const setStatus = (campaign: Campaign, status: CampaignStatus) =>
    runAction(campaign, () => apiFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, { method: "PUT", body: JSON.stringify({ status }) }));

  const duplicate = (campaign: Campaign) =>
    runAction(campaign, () => apiFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/duplicate`, { method: "POST" }));

  const remove = (campaign: Campaign) => {
    if (!window.confirm(`Supprimer le brouillon « ${campaign.name} » ? Cette action est définitive.`)) return;
    void runAction(campaign, () => apiFetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, { method: "DELETE" }));
  };

  const hasFilters = !!(search || occasion || quizId || catalogId || tab !== "ALL");

  return (
    <div className="page campaigns-page">
      <div className="page-header">
        <div>
          <h1 className="page-title campaigns-title">Campagnes</h1>
          <p className="page-subtitle">Associez vos quiz à vos temps forts commerciaux : fêtes, saisons, promotions.</p>
        </div>
        <Link className="btn-primary btn-lg" to="/campaigns/new"><Icon name="plus" />Nouvelle campagne</Link>
      </div>

      <div className="campaign-kpis">
        <Kpi icon="megaphone" label="Campagnes" value={counts.total} hint="au total" />
        <Kpi icon="eye" label="En ligne" value={counts.ACTIVE} hint="actuellement diffusées" />
        <Kpi icon="calendar" label="Programmées" value={counts.SCHEDULED} hint="démarrage à venir" />
        <Kpi icon="edit" label="Brouillons" value={counts.DRAFT} hint="en préparation" />
      </div>

      <div className="campaigns-layout">
        <section className="campaigns-main">
          <div className="campaign-toolbar">
            <div className="campaign-tabs" role="tablist" aria-label="Filtrer par statut">
              {TABS.filter((item) => item.key !== "PAUSED" || counts.PAUSED > 0 || tab === "PAUSED").map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`campaign-tab${tab === item.key ? " active" : ""}`}
                  onClick={() => setTab(item.key)}
                >
                  {item.label} ({item.key === "ALL" ? counts.total : counts[item.key]})
                </button>
              ))}
            </div>
            <div className="campaign-filters">
              <label className="campaign-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  placeholder="Rechercher une campagne…"
                  aria-label="Rechercher une campagne"
                  maxLength={100}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </label>
              <select className="field-select" aria-label="Filtrer par occasion" value={occasion} onChange={(e) => setOccasion(e.target.value as CampaignOccasion | "")}>
                <option value="">Toutes les occasions</option>
                {OCCASIONS.map((value) => <option key={value} value={value}>{OCCASION_LABELS[value]}</option>)}
              </select>
              {catalogs.length > 1 && (
                <select className="field-select" aria-label="Filtrer par catalogue" value={catalogId} disabled={catalogsLoading}
                  onChange={(e) => { setQuizId(""); setCatalogId(e.target.value); }}>
                  <option value="">Tous les catalogues</option>
                  {catalogs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              )}
              {catalogQuizzes.length > 1 && (
                <select className="field-select" aria-label="Filtrer par quiz" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
                  <option value="">Tous les quiz</option>
                  {catalogQuizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.name}</option>)}
                </select>
              )}
              <label className="campaign-sort">
                <Icon name="sort" size={16} />
                <select aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  {(Object.keys(SORT_LABELS) as Sort[]).map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
                </select>
              </label>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          {loading && campaigns.length === 0 ? (
            <div className="loading-block">Chargement...</div>
          ) : campaigns.length === 0 ? (
            <div className="empty-state campaign-empty">
              {hasFilters ? (
                <p>Aucune campagne ne correspond à ces critères.</p>
              ) : (
                <>
                  <p>Vous n'avez pas encore de campagne.</p>
                  <Link className="btn-primary" to="/campaigns/new">Créer ma première campagne</Link>
                </>
              )}
            </div>
          ) : (
            <ul className={`campaign-list${loading ? " is-refreshing" : ""}`}>
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  busy={busyId === campaign.id}
                  onOpen={() => navigate(`/campaigns/${campaign.id}`)}
                  onStatus={(status) => {
                    if (campaign.status === "DRAFT" && !window.confirm(`Mettre le brouillon « ${campaign.name} » en ligne ?`)) return;
                    void setStatus(campaign, status);
                  }}
                  onDuplicate={() => void duplicate(campaign)}
                  onDelete={() => remove(campaign)}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="campaign-ideas" aria-labelledby="campaign-ideas-title">
          <h2 id="campaign-ideas-title" className="campaign-ideas-title">Idées de campagnes</h2>
          <p className="campaign-ideas-hint">Un modèle pré-remplit le formulaire, vous gardez la main sur tout.</p>
          <ul>
            {CAMPAIGN_TEMPLATES.map((template) => (
              <li key={template.occasion}>
                <Link className="campaign-idea" to={`/campaigns/new?occasion=${template.occasion}`}>
                  <span className="campaign-idea-icon" aria-hidden="true">{template.icon}</span>
                  <span className="campaign-idea-text">
                    <strong>{template.title}</strong>
                    <span>{template.subtitle}</span>
                  </span>
                  <span className="campaign-idea-chevron" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: "megaphone" | "eye" | "calendar" | "edit"; label: string; value: number; hint: string }) {
  return (
    <div className="campaign-kpi">
      <span className="campaign-kpi-icon"><Icon name={icon} size={22} /></span>
      <div>
        <div className="campaign-kpi-label">{label}</div>
        <div className="campaign-kpi-value">{value}</div>
        <div className="campaign-kpi-hint">{hint}</div>
      </div>
    </div>
  );
}

interface CardProps {
  campaign: Campaign;
  busy: boolean;
  onOpen: () => void;
  onStatus: (status: CampaignStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function CampaignCard({ campaign, busy, onOpen, onStatus, onDuplicate, onDelete }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDraft = campaign.status === "DRAFT";
  const editPath = `/campaigns/${campaign.id}/edit`;
  const countdown = startsIn(campaign);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  return (
    <li className={`campaign-card${busy ? " is-busy" : ""}`}>
      <button type="button" className="campaign-thumb" onClick={onOpen} aria-label={`Voir ${campaign.name}`}>
        <CampaignImage campaign={campaign} />
      </button>

      <div className="campaign-body">
        <span className={`campaign-badge status-${campaign.effectiveStatus.toLowerCase()}`}>{STATUS_LABELS[campaign.effectiveStatus]}</span>
        <div className="campaign-name-row">
          <Link className="campaign-name" to={`/campaigns/${campaign.id}`}>{campaign.name}</Link>
          <span className="campaign-period">{formatPeriod(campaign)}</span>
        </div>
        {campaign.description && <p className="campaign-description">{campaign.description}</p>}
        <div className="campaign-chips">
          <span className="campaign-chip">{occasionName(campaign)}</span>
          <span className="campaign-chip"><Icon name="quiz" size={13} />{campaign.quiz.name} ({campaign.quiz.questionCount} question{campaign.quiz.questionCount > 1 ? "s" : ""})</span>
          {campaign.quiz.catalog && <span className="campaign-chip" title="Catalogue du quiz">{campaign.quiz.catalog.name}</span>}
          <span className="campaign-chip"><Icon name="box" size={13} />{campaign.quiz.productCount} produit{campaign.quiz.productCount > 1 ? "s" : ""}</span>
          {!campaign.quiz.active && <span className="campaign-chip chip-warning">Quiz désactivé</span>}
        </div>
      </div>

      <div className="campaign-side">
        <div className="campaign-top-actions">
          <dl className="campaign-stats" title="Statistiques par campagne : bientôt disponibles">
            <div><dt>Vues</dt><dd>—</dd></div>
            <div><dt>Complétées</dt><dd>—</dd></div>
            <div><dt>Ventes</dt><dd>—</dd></div>
          </dl>
          <CampaignStatusToggle campaign={campaign} disabled={busy} onChange={onStatus} />
          <div className="campaign-menu" ref={menuRef}>
            <button type="button" className="btn-icon" aria-label="Plus d'actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <Icon name="more" />
            </button>
            {menuOpen && (
              <div className="campaign-menu-list" role="menu">
                <Link role="menuitem" to={`/campaigns/${campaign.id}`}><Icon name="eye" size={16} />Voir</Link>
                <Link role="menuitem" to={editPath}><Icon name="edit" size={16} />Modifier</Link>
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onDuplicate(); }}><Icon name="copy" size={16} />Dupliquer</button>
                {isDraft && <button role="menuitem" type="button" className="danger" onClick={() => { setMenuOpen(false); onDelete(); }}><Icon name="trash" size={16} />Supprimer</button>}
              </div>
            )}
          </div>
        </div>
        {countdown && <p className="campaign-countdown">{countdown}</p>}
        <div className="campaign-actions">
          <Link className="btn-primary btn-sm campaign-personalize" to={`/campaigns/${campaign.id}/quiz-editor`}><Icon name="builder" size={16} />Personnaliser le quiz</Link>
          {!isDraft && <Link className="btn-ghost btn-sm" to={`/campaigns/${campaign.id}`}><Icon name="eye" size={16} />Voir</Link>}
          <Link className="btn-ghost btn-sm" to={editPath}><Icon name="edit" size={16} />{isDraft ? "Continuer" : "Modifier"}</Link>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onDuplicate}><Icon name="copy" size={16} />Dupliquer</button>
          {isDraft && (
            <button type="button" className="btn-ghost btn-sm btn-icon-only danger" disabled={busy} onClick={onDelete} aria-label={`Supprimer ${campaign.name}`}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
