import type { ExperienceListItem } from "@poapo/types";
import { publicAvailability } from "../../lib/experiences";

export default function ExperienceBadges({ experience, shopActive = true }: { experience: ExperienceListItem; shopActive?: boolean }) {
  // `accessible` combine déjà boutique et quiz : on ne distingue la cause que si la boutique est connue comme inactive.
  const availability = publicAvailability({ shopActive, quizActive: experience.accessible });
  return <div className="xp-badges">
    <span className={`xp-badge ${availability.accessible ? "public" : "inactive"}`} title={availability.reason ?? undefined}>
      {availability.label}{availability.reason ? ` · ${availability.reason}` : ""}
    </span>
    <span className={`xp-badge ${experience.hasDraft ? "draft" : "neutral"}`}>
      {experience.hasDraft ? "Brouillon enregistré" : "Aucun brouillon"}
    </span>
  </div>;
}
