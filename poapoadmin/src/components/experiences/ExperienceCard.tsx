import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ExperienceListItem } from "@poapo/types";
import Icon from "../Icon";
import { publicQuizLink, experienceEditorPath, quizPath } from "../../lib/experienceLinks";
import { questionCountLabel, quizStatus, primaryActionLabel } from "../../lib/experiences";

function RowMenu({ experience, tenantId, canResume }: { experience: ExperienceListItem; tenantId?: string; canResume: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const close = () => setOpen(false);

  return <div className="qz-menu" ref={root}>
    <button ref={trigger} type="button" className="qz-more" aria-haspopup="menu" aria-expanded={open}
      aria-label={`Autres actions : ${experience.name}`} onClick={() => setOpen((value) => !value)}>
      <Icon name="more" size={18} />
    </button>
    {open && <div className="qz-menu-list" role="menu" aria-label={`Actions : ${experience.name}`} onKeyDown={move}>
      {experience.accessible && tenantId && <a role="menuitem" href={publicQuizLink(tenantId, experience.id)} target="_blank" rel="noreferrer" onClick={close}>Prévisualiser (nouvel onglet)</a>}
      <Link role="menuitem" to={experienceEditorPath(experience.id)} onClick={close}>Modifier</Link>
      {canResume && <Link role="menuitem" to={experienceEditorPath(experience.id)} onClick={close}>Reprendre le brouillon</Link>}
      <Link role="menuitem" to={quizPath(experience, "/analytics")} onClick={close}>Voir les résultats</Link>
      <Link role="menuitem" to={quizPath(experience, "/quizzes/")} onClick={close}>Intégration et paramètres</Link>
    </div>}
  </div>;
}

export default function ExperienceCard({ experience, tenantId, days, shopActive }: {
  experience: ExperienceListItem;
  tenantId?: string;
  days: number;
  shopActive?: boolean;
}) {
  const status = quizStatus(experience, shopActive);
  const online = status.id === "online";
  const stats = experience.stats;
  return <article className={`qz-card ${status.id}`} data-status={status.id}>
    <div className="qz-cover" aria-hidden="true"><Icon name="quiz" size={24} /></div>
    <div className="qz-main">
      <h3 className="qz-name">{experience.name}</h3>
      <div className="qz-meta">
        <span className={`qz-badge ${status.id}`}>{status.label}</span>
        {status.reason && <span className="qz-note">{status.reason}</span>}
        {status.note && <span className="qz-note qz-pending">{status.note}</span>}
        <span className="qz-note">{questionCountLabel(experience.questionCount)}</span>
        {online && stats && <span className="qz-note" title={`Ces ${days} derniers jours`}>
          {stats.started} commencé{stats.started > 1 ? "s" : ""} · {stats.completed} terminé{stats.completed > 1 ? "s" : ""} · {stats.productClicks} clic{stats.productClicks > 1 ? "s" : ""} produit
        </span>}
      </div>
    </div>
    <div className="qz-actions">
      {online && <Link className="btn-ghost qz-secondary" to={quizPath(experience, "/analytics")}>Résultats<span className="sr-only"> : {experience.name}</span></Link>}
      <Link className={online ? "btn-ghost qz-primary-soft" : "btn-primary qz-primary"} to={experienceEditorPath(experience.id)}>
        {primaryActionLabel(experience, status)}<span className="sr-only"> : {experience.name}</span>
      </Link>
      <RowMenu experience={experience} tenantId={tenantId} canResume={experience.hasDraft && primaryActionLabel(experience, status) !== "Reprendre le brouillon"} />
    </div>
  </article>;
}
