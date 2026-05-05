// Genere une explication simple en 2-3 bullets, jamais technique.
const buildExplanation = (profile, profileSummary) => {
  const bullets = [];

  if (profile.freshness >= 0.6 && profile.intensity >= 0.55) {
    bullets.push("Frais mais avec du caractere");
  } else if (profile.freshness >= 0.6) {
    bullets.push("Frais et facile a porter");
  } else if (profile.intensity >= 0.65) {
    bullets.push("Une presence qui se remarque");
  } else if (profile.sweetness >= 0.65) {
    bullets.push("Doux et enveloppant");
  } else {
    bullets.push("Equilibre et agreable au quotidien");
  }

  if (profileSummary.usageMoment === "quotidien") {
    bullets.push("Ideal pour ton rythme quotidien");
  } else if (profileSummary.usageMoment === "soiree") {
    bullets.push("Parfait pour les soirees");
  } else {
    bullets.push("Un bon choix pour les occasions");
  }

  if (profile.intensity >= 0.6 || profile.sweetness >= 0.6) {
    bullets.push("Un parfum qui evolue bien sur la peau");
  }

  return bullets.slice(0, 3);
};

module.exports = { buildExplanation };
