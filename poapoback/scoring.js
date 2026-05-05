const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
const questions = JSON.parse(
  fs.readFileSync(path.join(dataDir, "questions.json"), "utf8")
);
const perfumes = JSON.parse(
  fs.readFileSync(path.join(dataDir, "perfumes.json"), "utf8")
);

// Set de reponses fictives: id question -> index de reponse choisi
const answersByQuestionId = {
  q1: 0,
  q2: 0,
  q3: 0,
  q4: 1,
  q5: 1,
  q6: 0,
  q7: 0,
  q8: 0,
  q9: 0,
  q10: 1,
};

const score = (questions, answers, perfumes) => {
  // Clamp pour garder les axes entre 0 et 1.
  const clamp = (v) => Math.max(0, Math.min(1, v));

  // Profil de base (neutre) puis accumulation des impacts.
  const profile = { freshness: 0.5, intensity: 0.5, sweetness: 0.5 };

  for (const q of questions) {
    const idx = answers[q.id];
    if (idx === undefined) {
      throw new Error(`Missing answer for question ${q.id}`);
    }

    const a = q.answers[idx];
    if (!a) {
      throw new Error(`Invalid answer index ${idx} for question ${q.id}`);
    }

    const i = a.impact || {};
    if (typeof i.freshness === "number") profile.freshness += i.freshness;
    if (typeof i.intensity === "number") profile.intensity += i.intensity;
    if (typeof i.sweetness === "number") profile.sweetness += i.sweetness;
  }

  profile.freshness = clamp(profile.freshness);
  profile.intensity = clamp(profile.intensity);
  profile.sweetness = clamp(profile.sweetness);

  // Distance euclidienne entre le profil et un parfum.
  const dist = (p) => {
    const df = p.freshness - profile.freshness;
    const di = p.intensity - profile.intensity;
    const ds = p.sweetness - profile.sweetness;
    return Math.sqrt(df * df + di * di + ds * ds);
  };

  // Choix du parfum le plus proche.
  let best = null;
  let bestScore = Infinity;
  for (const p of perfumes) {
    const s = dist(p);
    if (s < bestScore) {
      bestScore = s;
      best = p;
    }
  }

  return { profile, best };
};

const { profile, best } = score(questions, answersByQuestionId, perfumes);

console.log("Profil calcule:", profile);
console.log("Parfum choisi:", best ? best.name : "Aucun");
