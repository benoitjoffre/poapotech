import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Icon, { type IconName } from "../Icon";
import "./dashboard.css";

export function DashboardPanel({ id, title, icon, action, className = "", children }: {
  id: string;
  title: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <section className={`dashboard-panel ${className}`} aria-labelledby={id}>
    <div className="dashboard-panel-heading">
      <h2 id={id}>{icon && <Icon name={icon} />}{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

export function StatCard({ label, value, icon, caption }: {
  label: string;
  value: number;
  icon: IconName;
  caption: string;
}) {
  return <div className="dashboard-stat">
    <span className="dashboard-icon"><Icon name={icon} size={21} /></span>
    <dl><dt>{label}</dt><dd>{value.toLocaleString("fr-FR")}</dd></dl>
    <p className="dashboard-muted">{caption}</p>
  </div>;
}

export function ResourceLink({ to, title, description, icon }: {
  to: string;
  title: string;
  description: string;
  icon: IconName;
}) {
  return <Link className="dashboard-resource" to={to}>
    <span className="dashboard-icon"><Icon name={icon} size={20} /></span>
    <span><strong>{title}</strong><span className="dashboard-muted">{description}</span></span>
    <span aria-hidden="true">›</span>
  </Link>;
}
