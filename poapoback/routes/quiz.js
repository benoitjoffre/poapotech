const express = require("express");
const path = require("path");
const { recommend } = require("../sevices/recommender");
const { recordEvent, recordRecommendation, getSummary } = require("../sevices/metrics");

const questions = require(path.join(__dirname, "..", "data", "questions.json"));

const router = express.Router();

router.post("/submit", async (req, res) => {
  try {
    const { answers, gender, mood, variant } = req.body || {};
    const result = await recommend(answers, gender, mood);
    await recordRecommendation({
      gender,
      perfumeName: result?.perfume?.name,
      families: result?.perfume?.families,
      univers: result?.profileSummary?.univers,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/track", async (req, res) => {
  try {
    const { type, value, text, variant } = req.body || {};
    await recordEvent({ type, value, text, variant });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/metrics", async (req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/questions", (req, res) => {
  res.json(questions);
});

module.exports = router;
