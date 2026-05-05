const { normalizeAnswers, buildProfile, buildProfileSummary } = require("./profile");
const { pickBestPerfume } = require("./selection");
const { buildPurchaseLinks } = require("./purchase");
const { buildExplanation } = require("./explanation");

// Pipeline complet: normalisation des reponses -> profil -> parfum -> explication.
// Pipeline unique appele par l'API.
const recommend = async (answers, gender, mood) => {
  const answersById = normalizeAnswers(answers);
  const profile = buildProfile(answersById);
  const profileSummary = buildProfileSummary(profile);
  const { perfume, moodApplied } = pickBestPerfume(profile, gender, mood);
  const purchaseLinks = await buildPurchaseLinks(perfume);
  const explanationBullets = buildExplanation(profile, profileSummary);
  const explanation = `Voici ton parfum parce que : ${explanationBullets.map((b) => `• ${b}`).join(" ")}`;
  return {
    perfume,
    profile,
    profileSummary,
    explanation,
    explanationBullets,
    purchaseLinks,
    meta: {
      moodApplied,
    },
  };
};

module.exports = { recommend };
