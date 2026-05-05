const { questions } = require("./data");

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Transforme un score [0..1] en niveau lisible selon des seuils fixes.
const labelFromScore = (v, labels) => {
  if (v < 0.4) return labels[0];
  if (v < 0.65) return labels[1];
  return labels[2];
};

// Accepte plusieurs formats d'input et normalise en { [questionId]: answerIndex }.
// Exemples: { q1: 0, q2: 1 } ou [{ id: "q1", answerIndex: 0 }, ...].
const normalizeAnswers = (answers) => {
  if (!answers) {
    throw new Error("Missing answers");
  }

  // Format tableau: on mappe chaque item vers un id de question et un index de reponse.
  if (Array.isArray(answers)) {
    return answers.reduce((acc, item) => {
      const id = item.id || item.questionId || item.qid;
      const idx =
        item.answerIndex ?? item.answer ?? item.choice ?? item.selectedIndex;
      if (!id || typeof idx !== "number") {
        throw new Error("Invalid answers array item");
      }
      acc[id] = idx;
      return acc;
    }, {});
  }

  // Format objet deja normalise: { q1: 0, q2: 1, ... }.
  if (typeof answers === "object") {
    return answers;
  }

  throw new Error("Invalid answers format");
};

// Construit un profil en partant d'un neutre (0.5/0.5/0.5) et en cumulant les impacts.
const buildProfile = (answersById) => {
  const profile = { freshness: 0.5, intensity: 0.5, sweetness: 0.5 };

  // On itere toutes les questions pour garantir un set complet.
  for (const q of questions) {
    const idx = answersById[q.id];
    if (idx === undefined) {
      throw new Error(`Missing answer for question ${q.id}`);
    }

    const a = q.answers[idx];
    if (!a) {
      throw new Error(`Invalid answer index ${idx} for question ${q.id}`);
    }

    // Chaque reponse peut impacter un ou plusieurs axes.
    const i = a.impact || {};
    if (typeof i.freshness === "number") profile.freshness += i.freshness;
    if (typeof i.intensity === "number") profile.intensity += i.intensity;
    if (typeof i.sweetness === "number") profile.sweetness += i.sweetness;
  }

  // On clamp pour rester dans [0..1] apres accumulation.
  profile.freshness = clamp01(profile.freshness);
  profile.intensity = clamp01(profile.intensity);
  profile.sweetness = clamp01(profile.sweetness);

  return profile;
};

// Convertit le profil numerique en etiquettes UX stables.
const buildProfileSummary = (profile) => {
  const freshnessLevel = labelFromScore(profile.freshness, [
    "faible",
    "moderé",
    "élevé",
  ]);
  const intensityLevel = labelFromScore(profile.intensity, [
    "faible",
    "moderé",
    "élevé",
  ]);
  const sensualityLevel = labelFromScore(profile.sweetness, [
    "peu doux",
    "doux",
    "très doux",
  ]);

  // Moment d'usage: base sur intensite + douceur (proxy sillage/soirée).
  let usageMoment = "occasion";
  if (profile.intensity < 0.45 && profile.sweetness < 0.55) {
    usageMoment = "quotidien";
  } else if (profile.intensity >= 0.65 || profile.sweetness >= 0.65) {
    usageMoment = "soirée";
  }

  // Univers olfactif: combinaison de tags, avec fallback sur l'axe dominant.
  const univers = [];
  if (profile.freshness >= 0.6) univers.push("clean");
  if (profile.intensity >= 0.7 && profile.sweetness < 0.5) {
    univers.push("épice");
  } else if (profile.intensity >= 0.6) {
    univers.push("boisé");
  }
  if (profile.sweetness >= 0.65) {
    univers.push("gourmand");
  } else if (profile.sweetness >= 0.55) {
    univers.push("floral");
  }
  if (!univers.length) {
    // Fallback: on force un tag unique pour eviter un univers vide.
    const axes = [
      { key: "freshness", label: "clean" },
      { key: "intensity", label: "boise" },
      { key: "sweetness", label: "floral" },
    ];
    axes.sort((a, b) => profile[b.key] - profile[a.key]);
    univers.push(axes[0].label);
  }

  return {
    freshnessLevel,
    intensityLevel,
    sensualityLevel,
    usageMoment,
    univers,
  };
};

module.exports = {
  normalizeAnswers,
  buildProfile,
  buildProfileSummary,
};
