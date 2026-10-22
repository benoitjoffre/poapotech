import { useState } from "react";
import type { Campaign, CampaignStatus } from "@poapo/types";
import { CAMPAIGN_TEMPLATES, formatDate } from "../lib/campaigns";

export function CampaignImage({ campaign }: { campaign: Pick<Campaign, "imageUrl" | "occasion"> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (campaign.imageUrl && failedUrl !== campaign.imageUrl) {
    return <img src={campaign.imageUrl} alt="" loading="lazy" onError={() => setFailedUrl(campaign.imageUrl)} />;
  }
  const template = CAMPAIGN_TEMPLATES.find((item) => item.occasion === campaign.occasion);
  return (
    <span className={`campaign-fallback occasion-${campaign.occasion.toLowerCase()}`}>
      <span aria-hidden="true">{template?.icon ?? "📣"}</span>
    </span>
  );
}

/** Interrupteur en ligne / en pause. Il n'agit que sur le statut enregistré de la campagne. */
export function CampaignStatusToggle({
  campaign,
  disabled,
  onChange,
}: {
  campaign: Campaign;
  disabled?: boolean;
  onChange: (status: CampaignStatus) => void;
}) {
  const online = campaign.effectiveStatus === "ACTIVE";
  let lockedReason = "";
  if (campaign.effectiveStatus === "SCHEDULED" && campaign.startsAt) lockedReason = `Démarrage programmé le ${formatDate(campaign.startsAt)}`;
  else if (campaign.effectiveStatus === "COMPLETED") lockedReason = "Campagne terminée";
  else if (!online && !campaign.quiz.active) lockedReason = "Activez d'abord le quiz associé";
  const label = lockedReason || (online ? "Mettre en pause" : "Mettre en ligne");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label={label}
      title={label}
      className={`campaign-switch${online ? " on" : ""}`}
      disabled={disabled || !!lockedReason}
      onClick={() => onChange(online ? "PAUSED" : "ACTIVE")}
    >
      <span className="campaign-switch-knob" />
    </button>
  );
}
