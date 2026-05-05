const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const metricsFile = path.join(dataDir, "metrics.json");

const defaultMetrics = {
  quizStarted: 0,
  quizCompleted: 0,
  buyClicks: 0,
  purchases: 0,
  feedback: {
    up: 0,
    down: 0,
  },
  genders: {
    male: 0,
    female: 0,
    any: 0,
    unknown: 0,
  },
  perfumes: {},
  families: {},
  profileUnivers: {},
  decisionTimeMs: {
    total: 0,
    count: 0,
    min: null,
    max: null,
  },
  variants: {
    baseline: { quizStarted: 0, quizCompleted: 0, buyClicks: 0, purchases: 0 },
    poapo: { quizStarted: 0, quizCompleted: 0, buyClicks: 0, purchases: 0 },
  },
  verbatims: [],
};

const readMetrics = async () => {
  try {
    const raw = await fs.promises.readFile(metricsFile, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const backupPath = `${metricsFile}.corrupted`;
        await fs.promises
          .writeFile(backupPath, raw, "utf8")
          .catch(() => null);
        await writeMetrics({ ...defaultMetrics });
        return { ...defaultMetrics };
      }
      throw error;
    }
    return {
      ...defaultMetrics,
      ...parsed,
      feedback: {
        ...defaultMetrics.feedback,
        ...(parsed.feedback || {}),
      },
      genders: {
        ...defaultMetrics.genders,
        ...(parsed.genders || {}),
      },
      perfumes: typeof parsed.perfumes === "object" ? parsed.perfumes : {},
      families: typeof parsed.families === "object" ? parsed.families : {},
      profileUnivers:
        typeof parsed.profileUnivers === "object" ? parsed.profileUnivers : {},
      decisionTimeMs: {
        ...defaultMetrics.decisionTimeMs,
        ...(parsed.decisionTimeMs || {}),
      },
      variants: {
        ...defaultMetrics.variants,
        ...(parsed.variants || {}),
      },
      verbatims: Array.isArray(parsed.verbatims) ? parsed.verbatims : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ...defaultMetrics };
    }
    throw error;
  }
};

const writeMetrics = async (metrics) => {
  await fs.promises.writeFile(
    metricsFile,
    JSON.stringify(metrics, null, 2),
    "utf8"
  );
};

const normalizeText = (text) => {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
};

const normalizeGender = (gender) => {
  if (!gender) return "unknown";
  const g = String(gender).trim().toLowerCase();
  if (["male", "m", "homme", "man"].includes(g)) return "male";
  if (["female", "f", "femme", "woman"].includes(g)) return "female";
  if (["unisex", "mixte", "u", "neutral", "neutre", "any"].includes(g)) {
    return "any";
  }
  return "unknown";
};

const normalizeVariant = (variant) =>
  variant === "poapo" ? "poapo" : "baseline";

const recordEvent = async ({ type, value, text, variant }) => {
  const metrics = await readMetrics();
  const now = new Date().toISOString();
  const normalizedVariant = normalizeVariant(variant);
  const variantMetrics = metrics.variants?.[normalizedVariant];

  switch (type) {
    case "quiz_start":
      metrics.quizStarted += 1;
      if (variantMetrics) variantMetrics.quizStarted += 1;
      break;
    case "quiz_complete":
      metrics.quizCompleted += 1;
      if (variantMetrics) variantMetrics.quizCompleted += 1;
      break;
    case "buy_click":
      metrics.buyClicks += 1;
      if (variantMetrics) variantMetrics.buyClicks += 1;
      break;
    case "purchase":
      metrics.purchases += 1;
      if (variantMetrics) variantMetrics.purchases += 1;
      break;
    case "decision_time": {
      const ms = Number(value);
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error("Invalid decision time");
      }
      metrics.decisionTimeMs.total += ms;
      metrics.decisionTimeMs.count += 1;
      metrics.decisionTimeMs.min =
        metrics.decisionTimeMs.min === null
          ? ms
          : Math.min(metrics.decisionTimeMs.min, ms);
      metrics.decisionTimeMs.max =
        metrics.decisionTimeMs.max === null
          ? ms
          : Math.max(metrics.decisionTimeMs.max, ms);
      break;
    }
    case "feedback": {
      const normalized = String(value || "").toLowerCase();
      if (normalized === "up" || normalized === "thumbs_up" || normalized === "👍") {
        metrics.feedback.up += 1;
      } else if (
        normalized === "down" ||
        normalized === "thumbs_down" ||
        normalized === "👎"
      ) {
        metrics.feedback.down += 1;
      } else {
        throw new Error("Invalid feedback value");
      }
      break;
    }
    case "verbatim": {
      const cleaned = normalizeText(text);
      if (!cleaned) {
        throw new Error("Missing verbatim text");
      }
      metrics.verbatims.push({ text: cleaned, createdAt: now });
      if (metrics.verbatims.length > 50) {
        metrics.verbatims = metrics.verbatims.slice(-50);
      }
      break;
    }
    default:
      throw new Error("Invalid event type");
  }

  await writeMetrics(metrics);
  return metrics;
};

const toPercent = (value) => Math.round(value * 1000) / 10;

const recordRecommendation = async ({
  gender,
  perfumeName,
  families,
  univers,
}) => {
  const metrics = await readMetrics();
  const normalizedGender = normalizeGender(gender);
  metrics.genders[normalizedGender] =
    (metrics.genders[normalizedGender] || 0) + 1;

  const cleanedName = normalizeText(perfumeName);
  if (cleanedName) {
    metrics.perfumes[cleanedName] = (metrics.perfumes[cleanedName] || 0) + 1;
  }

  if (Array.isArray(families)) {
    families.forEach((family) => {
      const key = normalizeText(family).toLowerCase();
      if (!key) return;
      metrics.families[key] = (metrics.families[key] || 0) + 1;
    });
  }

  if (Array.isArray(univers)) {
    univers.forEach((tag) => {
      const key = normalizeText(tag).toLowerCase();
      if (!key) return;
      metrics.profileUnivers[key] = (metrics.profileUnivers[key] || 0) + 1;
    });
  }

  await writeMetrics(metrics);
  return metrics;
};

const getSummary = async () => {
  const metrics = await readMetrics();
  const started = metrics.quizStarted;
  const completed = metrics.quizCompleted;
  const buyClicks = metrics.buyClicks;
  const feedbackTotal = metrics.feedback.up + metrics.feedback.down;
  const decisionAvgMs = metrics.decisionTimeMs.count
    ? Math.round(metrics.decisionTimeMs.total / metrics.decisionTimeMs.count)
    : 0;

  const completionRate = started ? completed / started : 0;
  const buyClickRate = completed ? buyClicks / completed : 0;
  const upRate = feedbackTotal ? metrics.feedback.up / feedbackTotal : 0;
  const downRate = feedbackTotal ? metrics.feedback.down / feedbackTotal : 0;

  const genderTotal =
    metrics.genders.male +
    metrics.genders.female +
    metrics.genders.any +
    metrics.genders.unknown;

  const genderStats = {
    counts: { ...metrics.genders },
    percents: {
      male: toPercent(genderTotal ? metrics.genders.male / genderTotal : 0),
      female: toPercent(genderTotal ? metrics.genders.female / genderTotal : 0),
      any: toPercent(genderTotal ? metrics.genders.any / genderTotal : 0),
      unknown: toPercent(
        genderTotal ? metrics.genders.unknown / genderTotal : 0
      ),
    },
  };

  const topPerfumes = Object.entries(metrics.perfumes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    counts: {
      quizStarted: started,
      quizCompleted: completed,
      buyClicks,
      purchases: metrics.purchases,
      feedbackUp: metrics.feedback.up,
      feedbackDown: metrics.feedback.down,
    },
    rates: {
      completionPercent: toPercent(completionRate),
      buyClickPercent: toPercent(buyClickRate),
      feedbackUpPercent: toPercent(upRate),
      feedbackDownPercent: toPercent(downRate),
    },
    decisionTime: {
      avgMs: decisionAvgMs,
      minMs: metrics.decisionTimeMs.min,
      maxMs: metrics.decisionTimeMs.max,
    },
    profileUnivers: metrics.profileUnivers,
    families: metrics.families,
    variants: metrics.variants,
    genderStats,
    topPerfumes,
    verbatims: metrics.verbatims.slice(-5).reverse(),
  };
};

module.exports = {
  recordEvent,
  recordRecommendation,
  getSummary,
};
