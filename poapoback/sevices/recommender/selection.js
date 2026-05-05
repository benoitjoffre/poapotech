const { perfumes } = require("./data");

const MOOD_FAMILY_MAP = {
  frais: ["fresh", "citrus", "marine", "aromatic"],
  boise: ["woody", "earthy"],
  floral: ["floral", "aldehydic", "powdery"],
  gourmand: ["gourmand", "amber", "oriental"],
};

const normalizeMood = (mood) => {
  if (!mood) return null;
  const raw = String(mood).trim().toLowerCase();
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!Object.prototype.hasOwnProperty.call(MOOD_FAMILY_MAP, normalized)) {
    return null;
  }
  return normalized;
};

// Normalise les valeurs de genre pour filtrer la base si possible.
const normalizeGender = (gender) => {
  if (!gender) return "any";
  const g = String(gender).trim().toLowerCase();
  if (["male", "m", "homme", "man"].includes(g)) return "male";
  if (["female", "f", "femme", "woman"].includes(g)) return "female";
  if (["unisex", "mixte", "u", "neutral", "neutre"].includes(g)) return "any";
  return "any";
};

// Choisit le parfum le plus proche du profil (distance euclidienne).
// Si un genre est fourni, on filtre la liste (male/female).
const pickBestPerfume = (profile, gender, mood) => {
  // Distance entre deux points (profil et parfum) dans l'espace 3D.
  const dist = (p) => {
    const df = p.freshness - profile.freshness;
    const di = p.intensity - profile.intensity;
    const ds = p.sweetness - profile.sweetness;
    return Math.sqrt(df * df + di * di + ds * ds);
  };

  const moodKey = normalizeMood(mood);
  const moodFamilies = moodKey ? MOOD_FAMILY_MAP[moodKey] : null;
  const moodWeight = 0.2;
  const moodMatchRatio = (perfume) => {
    if (!moodFamilies || !Array.isArray(perfume.families)) return 0;
    const families = perfume.families.map((f) => String(f).toLowerCase());
    const matches = moodFamilies.filter((family) => families.includes(family));
    return matches.length / moodFamilies.length;
  };

  let best = null;
  let bestScore = Infinity;

  const normalizedGender = normalizeGender(gender);
  let pool = normalizedGender !== "any" ? perfumes.filter((p) => p.gender === normalizedGender) : perfumes;
  if (!pool.length) {
    // Si aucun parfum ne matche le genre, on repart sur tout le catalogue.
    pool = perfumes;
  }

  // Recherche du score minimal.
  let bestMoodRatio = 0;
  for (const p of pool) {
    const ratio = moodMatchRatio(p);
    const s = dist(p) - ratio * moodWeight;
    if (s < bestScore) {
      bestScore = s;
      best = p;
      bestMoodRatio = ratio;
    }
  }

  return {
    perfume: best,
    moodApplied: Boolean(moodFamilies && bestMoodRatio > 0),
  };
};

module.exports = {
  pickBestPerfume,
};
