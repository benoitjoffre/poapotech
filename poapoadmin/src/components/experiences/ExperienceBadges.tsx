import type { ExperienceListItem } from "@poapo/types";

export default function ExperienceBadges({ experience }: { experience: ExperienceListItem }) {
  return <div className="xp-badges">
    <span className={`xp-badge ${experience.accessible ? "public" : "inactive"}`}>
      {experience.accessible ? "Accessible au public" : "Désactivée pour le public"}
    </span>
    <span className={`xp-badge ${experience.hasDraft ? "draft" : "neutral"}`}>
      {experience.hasDraft ? "Brouillon enregistré" : "Aucun brouillon"}
    </span>
  </div>;
}
