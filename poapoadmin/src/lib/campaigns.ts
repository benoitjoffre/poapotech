import type { Campaign, CampaignOccasion, CampaignStatus } from "@poapo/types";

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmée",
  ACTIVE: "En cours",
  PAUSED: "En pause",
  COMPLETED: "Terminée",
};

export const OCCASION_LABELS: Record<CampaignOccasion, string> = {
  CHRISTMAS: "Noël",
  VALENTINES_DAY: "Saint-Valentin",
  SPRING: "Printemps",
  MOTHERS_DAY: "Fête des Mères",
  BACK_TO_SCHOOL: "Rentrée",
  BLACK_FRIDAY: "Black Friday",
  PROMOTION: "Promotion",
  PERMANENT: "Permanente",
  CUSTOM: "Personnalisée",
};

export const OCCASIONS = Object.keys(OCCASION_LABELS) as CampaignOccasion[];
export const STATUSES = Object.keys(STATUS_LABELS) as CampaignStatus[];

export interface CampaignTemplate {
  occasion: CampaignOccasion;
  icon: string;
  title: string;
  subtitle: string;
}

/** Modèles statiques : ils pré-remplissent uniquement le formulaire de création. */
export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  { occasion: "CHRISTMAS", icon: "🎁", title: "Noël", subtitle: "Cadeaux et idées pour les fêtes" },
  { occasion: "VALENTINES_DAY", icon: "❤️", title: "Saint-Valentin", subtitle: "Cadeaux pour les amoureux" },
  { occasion: "SPRING", icon: "🌸", title: "Printemps", subtitle: "Nouveautés et beaux jours" },
  { occasion: "MOTHERS_DAY", icon: "🌷", title: "Fête des Mères", subtitle: "Des attentions pour toutes les mamans" },
  { occasion: "BACK_TO_SCHOOL", icon: "🎒", title: "Rentrée", subtitle: "Reprise et nouveaux rituels" },
  { occasion: "BLACK_FRIDAY", icon: "🏷️", title: "Black Friday", subtitle: "Promotions et best-sellers" },
  { occasion: "CUSTOM", icon: "✨", title: "Campagne personnalisée", subtitle: "Décrivez votre propre événement" },
];

export function occasionName(campaign: Pick<Campaign, "occasion" | "occasionLabel">): string {
  return campaign.occasion === "CUSTOM" && campaign.occasionLabel ? campaign.occasionLabel : OCCASION_LABELS[campaign.occasion];
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function formatPeriod(campaign: Pick<Campaign, "startsAt" | "endsAt">): string {
  const { startsAt, endsAt } = campaign;
  if (!startsAt && !endsAt) return "Non planifiée";
  if (startsAt && endsAt) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const startText = start.getFullYear() === end.getFullYear() ? dayMonth.format(start) : fullDate.format(start);
    return `${startText} → ${fullDate.format(end)}`;
  }
  if (startsAt) return new Date(startsAt) > new Date() ? `À partir du ${formatDate(startsAt)}` : `Depuis le ${formatDate(startsAt)}`;
  return `Jusqu'au ${formatDate(endsAt!)}`;
}

/** « Démarre dans 28 jours » pour une campagne programmée, sinon null. */
export function startsIn(campaign: Pick<Campaign, "effectiveStatus" | "startsAt">): string | null {
  if (campaign.effectiveStatus !== "SCHEDULED" || !campaign.startsAt) return null;
  const days = Math.ceil((new Date(campaign.startsAt).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? "Démarre demain" : `Démarre dans ${days} jours`;
}

/** Date ISO → valeur d'un input type="date" (jour local). */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Valeur d'un input type="date" → ISO ; la fin couvre toute la journée locale. */
export function fromDateInput(value: string, endOfDay = false): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
  return date.toISOString();
}
