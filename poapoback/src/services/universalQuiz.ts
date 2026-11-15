import type {
  AnswerEffect, AnswerEffects, ColumnProfile, ExpressAnalysis, ExpressAnswer, ExpressAxis, ExpressCriterionSummary, ExpressDraft,
  ExpressProposal, ExpressQuestion, ExpressQuestionInfo, ExpressQuestionKind,
} from "@poapo/types";
import { AXIS_KEY_PATTERN } from "./axes";
import { profileColumns, quantile } from "./catalogProfile";
import { selectQuizCriteria, type CriterionCandidate } from "./criteriaSelection";
import { universalQuestionsEnabled } from "./expressFlags";
import { deterministicGenerator, detectSector, MAX_EXPRESS_AXES, QUESTION_COUNTS, validateExpressDraft, type DraftGenerator, type ExpressContext, type ExpressOptions } from "./expressQuiz";
import { sectorById } from "./expressSectors";
import { DRAFT_TEXT_LIMITS, GENERATION_LIMITS } from "./generationLimits";
import { QuizError } from "./quizzes";

/**
 * Générateur universel de questions (lot 10D-2C). Les critères viennent des DONNÉES (diagnostic 10B + sélecteur 10D-1), jamais d'un modèle
 * sectoriel ; les modèles sectoriels ne servent qu'à reformuler la question d'un critère déjà retenu.
 *
 * Réponse → effet (aucune question décorative) :
 *   critère chiffré 0–1 (axe)   → impacts ±0,25 sur l'axe (mécanisme historique)           « Sans préférence » : aucun impact, effet neutre
 *   catégorie (famille, type…)  → préférence SOUPLE sur la valeur choisie                   « Sans préférence » : neutre
 *   prix                        → préférence SOUPLE de tranche (défaut) ou plafond STRICT   « Pas de budget précis » : neutre
 *                                 (plafond strict : décision explicite du commerçant, données fiables à 90 % minimum)
 * Valeur absente sur un produit : jamais de bonus (souple) ; produit écarté (strict, politique « exclude »).
 * Critères au rôle incertain (marque, mesure, oui/non, mots-clés) : proposés en suggestions « à valider », jamais dans le brouillon.
 * Le brouillon généré est revalidé par validateExpressDraft ; en cas d'échec ou si rien n'est exploitable : repli sur le générateur historique.
 */

export const UNIVERSAL_LIMITS = {
  /** Questions du brouillon sans demande explicite (expérience visiteur) ; 3, 5 ou 7 si le commerçant choisit. */
  defaultQuestions: 6,
  /** Options catégorielles proposées (+ « Sans préférence » = 6 réponses au plus). */
  maxChoices: 5,
  strictMinCoverage: 0.9,
  axisImpact: 0.25,
  labelLength: 60,
} as const;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const foldKey = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const clip = (value: string) => (value.length > UNIVERSAL_LIMITS.labelLength ? `${value.slice(0, UNIVERSAL_LIMITS.labelLength - 1)}…` : value);
const pct = (value: number) => `${Math.round(value * 100)} %`;
const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ","));

/** Arrondi lisible d'une borne de prix (pas de 1, 5, 10 ou 50 selon l'ordre de grandeur). */
function nice(value: number): number {
  const step = value < 20 ? 1 : value < 100 ? 5 : value < 500 ? 10 : 50;
  return Math.max(step, Math.round(value / step) * step);
}

/** Libellé destiné au visiteur : l'en-tête du commerçant sans l'unité entre parenthèses (« Contenance (ml) » → « contenance »). */
const visitorLabel = (merchantLabel: string) => lowerFirst(merchantLabel.replace(/\s*\([^)]*\)\s*$/, "").trim() || merchantLabel);

const noPreference = (criterion: string, text = "Sans préférence"): ExpressAnswer => ({
  text, emoji: null, impacts: {}, effects: { v: 1, effects: [{ type: "none", criterion }] }, effectSummary: "Ne change pas le classement",
});
const withEffect = (text: string, effect: AnswerEffect, summary: string): ExpressAnswer => ({
  text: clip(text), emoji: null, impacts: {}, effects: { v: 1, effects: [effect] } as AnswerEffects, effectSummary: summary,
});

function info(c: CriterionCandidate, kind: ExpressQuestionKind, strict = false): ExpressQuestionInfo {
  return {
    criterion: c.label, kind, strict, needsValidation: c.needsValidation, validationReason: c.validationReason,
    coverageNote: c.coverage < UNIVERSAL_LIMITS.strictMinCoverage ? `Renseigné sur ${pct(c.coverage)} des produits : les autres ne sont pas départagés par cette question.` : null,
  };
}

interface Built { question: ExpressQuestion; axis?: ExpressAxis; kind: ExpressQuestionKind }

// ─── Critère chiffré 0–1 (axe) ────────────────────────────────────────────────

function axisQuestion(c: CriterionCandidate, profile: ColumnProfile, context: ExpressContext, options: ExpressOptions): Built | null {
  const key = profile.name;
  if (!AXIS_KEY_PATTERN.test(key)) return null;
  const prior = context.existingAxes.find((axis) => axis.key === key);
  const sector = options.sector && options.sector !== "generic" ? sectorById(options.sector) : options.sector === "generic" ? null : detectSector(context);
  const template = sector?.axes.find((axis) => axis.aliases.includes(foldKey(key)));
  const label = prior?.label ?? template?.label ?? c.label;
  const lowLabel = prior?.lowLabel ?? template?.lowLabel ?? null;
  const highLabel = prior?.highLabel ?? template?.highLabel ?? null;
  const dist = profile.distribution.kind === "numeric" ? profile.distribution : null;
  const axis: ExpressAxis = {
    key, label, lowLabel, highLabel,
    description: template?.description ?? `Position du produit sur « ${label} », de 0 (faible) à 1 (fort).`,
    justification: `Renseigné sur ${profile.productCount} produit(s) sur ${profile.totalProducts} : il permet de départager vos produits.`,
    evidence: "data", reused: !!prior, valuedProducts: profile.productCount, spread: dist ? Math.round((dist.p90 - dist.p10) * 100) / 100 : 0,
  };
  // Formulation : question type du secteur si elle porte uniquement sur ce critère (reformulation seulement), sinon question générique.
  const templateQuestion = template && sector?.questions.find((q) => q.answers.length === 2 && q.answers.every((a) => Object.keys(a.impacts).length === 1 && template.key in a.impacts));
  const impact = UNIVERSAL_LIMITS.axisImpact;
  const answers: ExpressAnswer[] = templateQuestion
    ? templateQuestion.answers.map((a) => ({ text: clip(a.text), emoji: a.emoji, impacts: { [key]: Math.sign(a.impacts[template!.key]) * impact }, effectSummary: `Oriente vers : ${a.text}` }))
    : [
      { text: clip(lowLabel || `Plutôt peu de ${visitorLabel(label)}`), emoji: null, impacts: { [key]: -impact }, effectSummary: `Oriente vers : ${lowLabel || `peu de ${lowerFirst(label)}`}` },
      { text: clip(highLabel || `Plutôt beaucoup de ${visitorLabel(label)}`), emoji: null, impacts: { [key]: impact }, effectSummary: `Oriente vers : ${highLabel || `beaucoup de ${lowerFirst(label)}`}` },
    ];
  return {
    kind: "axis", axis,
    question: {
      text: templateQuestion?.text ?? `Côté ${visitorLabel(label)}, qu'est-ce qui vous correspond le mieux ?`, helpText: null,
      info: info(c, "axis"), answers: [...answers, noPreference(`attribute.${key}`)],
    },
  };
}

// ─── Catégorie ────────────────────────────────────────────────────────────────

function choiceQuestion(c: CriterionCandidate): Built | null {
  const options = c.options.slice(0, UNIVERSAL_LIMITS.maxChoices);
  if (options.length < 2) return null;
  const answers = options.map((option) => withEffect(option.label,
    { type: "category", criterion: c.id, mode: "soft", values: [option.label] }, `Favorise les produits « ${option.label} » ; les autres restent proposés`));
  return {
    kind: "choice",
    question: { text: `Côté ${visitorLabel(c.label)}, qu'est-ce qui vous attire le plus ?`, helpText: null, info: info(c, "choice"), answers: [...answers, noPreference(c.id)] },
  };
}

// ─── Oui / non (suggestion à valider) ─────────────────────────────────────────

function yesNoQuestion(c: CriterionCandidate, profile: ColumnProfile): Built | null {
  const value = profile.valueKind === "number" ? "1" : "true";
  return {
    kind: "yesno",
    question: {
      text: `${visitorLabel(c.label).charAt(0).toUpperCase()}${visitorLabel(c.label).slice(1)} : est-ce important pour vous ?`, helpText: null, info: info(c, "yesno"),
      answers: [
        withEffect("Oui, de préférence", { type: "category", criterion: c.id, mode: "soft", values: [value] }, "Favorise les produits concernés ; les autres restent proposés"),
        noPreference(c.id, "Peu importe"),
      ],
    },
  };
}

// ─── Prix et mesures ──────────────────────────────────────────────────────────

function priceBands(products: ExpressContext["products"], criterion: string) {
  const values = products.map((p) => criterion === "price" ? p.price : (p.attributes as Record<string, unknown> | null)?.[criterion.slice("attribute.".length)])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (new Set(values).size < 3) return null;
  const min = values[0];
  let b1 = Math.max(nice(quantile(values, 1 / 3)), Math.ceil(min));
  let b2 = Math.max(nice(quantile(values, 2 / 3)), b1 + 1);
  if (b2 <= b1) b2 = b1 + 1;
  const count = (predicate: (v: number) => boolean) => values.filter(predicate).length;
  if (!count((v) => v <= b1) || !count((v) => v > b1 && v <= b2) || !count((v) => v > b2)) return null;
  return { b1, b2 };
}

function budgetQuestion(c: CriterionCandidate, profile: ColumnProfile, context: ExpressContext, strictRequested: boolean): (Built & { strictApplied: boolean; strictRefused: boolean }) | null {
  const bands = priceBands(context.products, c.id);
  if (!bands) return null;
  const { b1, b2 } = bands;
  const strictOk = profile.coverage >= UNIVERSAL_LIMITS.strictMinCoverage && profile.parseRate >= UNIVERSAL_LIMITS.strictMinCoverage;
  const strict = strictRequested && strictOk;
  const range = (mode: "soft" | "strict", min?: number, max?: number): AnswerEffect => ({ type: "range", criterion: c.id, mode, ...(min !== undefined && { min }), ...(max !== undefined && { max }) });
  const answers = strict
    ? [
      withEffect(`Jusqu'à ${fmt(b1)} €`, range("strict", undefined, b1), `Écarte tous les produits au-dessus de ${fmt(b1)} €`),
      withEffect(`Jusqu'à ${fmt(b2)} €`, range("strict", undefined, b2), `Écarte tous les produits au-dessus de ${fmt(b2)} €`),
      noPreference(c.id, "Pas de limite de budget"),
    ]
    : [
      withEffect(`Jusqu'à ${fmt(b1)} €`, range("soft", undefined, b1), `Favorise les produits jusqu'à ${fmt(b1)} € ; les autres restent proposés`),
      withEffect(`Entre ${fmt(b1)} et ${fmt(b2)} €`, range("soft", b1, b2), `Favorise les produits entre ${fmt(b1)} et ${fmt(b2)} € ; les autres restent proposés`),
      withEffect(`Plus de ${fmt(b2)} €`, range("soft", b2), `Favorise les produits au-dessus de ${fmt(b2)} € ; les autres restent proposés`),
      noPreference(c.id, "Pas de budget précis"),
    ];
  return {
    kind: "budget", strictApplied: strict, strictRefused: strictRequested && !strictOk,
    question: {
      text: "Quel budget avez-vous en tête ?", helpText: strict ? "Les produits au-dessus du budget choisi ne sont jamais proposés." : "Les produits hors de ce budget restent proposés s'ils correspondent mieux au reste de vos réponses.",
      info: info(c, "budget", strict), answers,
    },
  };
}

function measureQuestion(c: CriterionCandidate, context: ExpressContext): Built | null {
  const bands = priceBands(context.products, c.id);
  if (!bands) return null;
  const { b1, b2 } = bands;
  const range = (min?: number, max?: number): AnswerEffect => ({ type: "range", criterion: c.id, mode: "soft", ...(min !== undefined && { min }), ...(max !== undefined && { max }) });
  return {
    kind: "measure",
    question: {
      text: `Côté ${visitorLabel(c.label)}, que recherchez-vous ?`, helpText: null, info: info(c, "measure"),
      answers: [
        withEffect(`Petite valeur (jusqu'à ${fmt(b1)})`, range(undefined, b1), "Favorise les valeurs basses ; les autres restent proposées"),
        withEffect(`Valeur moyenne (${fmt(b1)} à ${fmt(b2)})`, range(b1, b2), "Favorise les valeurs moyennes ; les autres restent proposées"),
        withEffect(`Grande valeur (plus de ${fmt(b2)})`, range(b2), "Favorise les valeurs hautes ; les autres restent proposées"),
        noPreference(c.id),
      ],
    },
  };
}

// ─── Assemblage ───────────────────────────────────────────────────────────────

const REASONS: Record<string, string> = {
  INSUFFICIENT_COVERAGE: "trop peu renseigné sur vos produits",
  CONSTANT_VALUE: "la même valeur partout",
  INSUFFICIENT_VARIATION: "presque tous les produits ont la même valeur",
  HIGH_CARDINALITY: "presque une valeur différente par produit",
  UNSUPPORTED_STRUCTURE: "texte libre ou structure non exploitable",
  INVALID_VALUES: "valeurs de types mélangés",
  IDENTIFIER_LIKE: "ressemble à une référence ou à un code",
  METADATA_FIELD: "champ interne, pas un critère de choix",
  CODE_LIKE_VALUES: "valeurs qui ressemblent à des codes internes",
  INSUFFICIENT_GAIN: "sépare trop peu de produits",
  REDUNDANT: "fait presque la même séparation qu'un autre critère",
  LIMIT_REACHED: "utile, mais au-delà du nombre de questions retenu pour garder un quiz court",
  TOO_FEW_PRODUCTS: "trop peu de produits",
};

export interface UniversalBuild {
  draft: ExpressDraft;
  alternatives: ExpressQuestion[];
  criteria: ExpressCriterionSummary[];
  notes: string[];
}

/** Construit le brouillon avancé ; null si aucun critère n'est exploitable. Pur : aucun accès base, aucun réseau. */
export function buildUniversalDraft(context: ExpressContext, options: ExpressOptions): UniversalBuild | null {
  const axisKeys = context.existingAxes.map((axis) => axis.key);
  const profiles = profileColumns(context.products, { axisKeys });
  const profileOf = new Map(profiles.map((p) => [p.key, p]));
  const excluded = new Set((options.exclude ?? []).map(foldKey));
  const selected = selectQuizCriteria(profiles, context.products, { maxCriteria: 12 });
  // Libellé du commerçant = en-tête d'origine du CSV quand il est connu (accents et unités conservés) ; la clé technique ne change jamais.
  const selection = { ...selected, criteria: selected.criteria.map((c) => {
    const header = context.attributeLabels?.[profileOf.get(c.id)?.name ?? ""];
    return header && c.source === "attribute" ? { ...c, label: header } : c;
  }) };
  const isExcluded = (c: CriterionCandidate) => excluded.has(foldKey(c.id)) || excluded.has(foldKey(profileOf.get(c.id)?.name ?? ""));
  const cap = options.questionCount && QUESTION_COUNTS.includes(options.questionCount) ? options.questionCount : UNIVERSAL_LIMITS.defaultQuestions;
  const notes: string[] = [];

  const built: { c: CriterionCandidate; b: Built }[] = [];
  const axes: ExpressAxis[] = [];
  const unused = new Map<string, string>();
  let strictApplied = false;
  for (const c of selection.criteria.filter((x) => x.status === "selected")) {
    if (isExcluded(c)) { unused.set(c.id, "retiré à votre demande"); continue; }
    const profile = profileOf.get(c.id)!;
    let b: Built | null = null;
    if (c.handling === "numeric_preference") {
      if (axes.length >= MAX_EXPRESS_AXES) { unused.set(c.id, `au-delà de ${MAX_EXPRESS_AXES} critères chiffrés`); continue; }
      b = axisQuestion(c, profile, context, options);
    } else if (c.handling === "categorical_choice") b = choiceQuestion(c);
    else if (c.handling === "budget_range") {
      const budget = budgetQuestion(c, profile, context, options.strictBudget === true);
      if (budget) {
        b = budget;
        strictApplied = budget.strictApplied;
        if (budget.strictRefused) notes.push("Le plafond de budget strict n'a pas été proposé : le prix n'est pas assez fiable (couverture ou validité sous 90 %). Une préférence de budget souple est proposée à la place.");
      }
    }
    if (!b) { unused.set(c.id, "pas de question compréhensible possible avec ces valeurs"); continue; }
    if (b.axis) axes.push(b.axis);
    built.push({ c, b });
  }

  // Expérience visiteur : au plus `cap` questions, la question de budget en dernier.
  // Le budget garde sa place (critère de choix décisif pour un visiteur, valable pour tout secteur) : ce sont les autres critères les moins utiles qui cèdent.
  const budgets = built.filter((x) => x.b.kind === "budget").slice(0, 1);
  const others = built.filter((x) => x.b.kind !== "budget").slice(0, Math.max(0, cap - budgets.length));
  const kept = [...others, ...budgets];
  for (const dropped of built.filter((x) => !kept.includes(x))) unused.set(dropped.c.id, REASONS.LIMIT_REACHED);
  const keptAxes = axes.filter((axis) => kept.some((x) => x.b.axis?.key === axis.key));
  if (!kept.length) return null;
  if (options.strictBudget === true && !strictApplied && !notes.length) notes.push("Aucune question de budget n'a pu être proposée : le catalogue ne contient pas assez de prix distincts.");

  // Suggestions à valider (rôle incertain) : jamais dans le brouillon.
  const alternatives: ExpressQuestion[] = [];
  const toValidate: CriterionCandidate[] = [];
  for (const c of selection.criteria.filter((x) => x.status === "needs_validation" && !isExcluded(x))) {
    const profile = profileOf.get(c.id)!;
    const suggestion = c.handling === "yes_no" ? yesNoQuestion(c, profile)
      : c.handling === "budget_range" ? measureQuestion(c, context)
      : c.handling === "categorical_choice" ? choiceQuestion(c) : null;
    if (suggestion) { alternatives.push(suggestion.question); toValidate.push(c); }
  }

  const criteria: ExpressCriterionSummary[] = [
    ...kept.map(({ c, b }): ExpressCriterionSummary => ({ label: c.label, kind: b.kind, status: "used", coverage: c.coverage,
      reason: `Renseigné sur ${pct(c.coverage)} des produits${c.coverage < UNIVERSAL_LIMITS.strictMinCoverage ? " : les autres ne sont pas départagés" : ""}.` })),
    ...toValidate.map((c): ExpressCriterionSummary => ({ label: c.label, kind: c.handling === "yes_no" ? "yesno" : c.handling === "budget_range" ? "measure" : "choice", status: "to_validate", coverage: c.coverage,
      reason: c.validationReason ?? "À valider avant d'être demandé aux visiteurs." })),
    ...selection.criteria.filter((c) => c.status === "rejected" && c.id !== "tags" || c.status === "selected").flatMap((c): ExpressCriterionSummary[] => {
      if (kept.some((x) => x.c.id === c.id)) return [];
      const reason = unused.get(c.id) ?? (c.rejection ? REASONS[c.rejection.code] ?? c.rejection.message : null);
      return reason ? [{ label: c.label, kind: c.handling === "budget_range" ? "budget" : c.handling === "numeric_preference" ? "axis" : "choice", status: "left_out", coverage: c.coverage, reason: `Non utilisé : ${reason}.` }] : [];
    }),
  ];

  const sector = options.sector && options.sector !== "generic" ? sectorById(options.sector) : options.sector === "generic" ? null : detectSector(context);
  const sectorName = sector?.label.toLowerCase();
  const draft: ExpressDraft = {
    name: `Expérience express – ${context.catalogName}`.slice(0, DRAFT_TEXT_LIMITS.name),
    quizTitle: sector?.quizTitle ?? (sectorName ? `Trouvez ${sectorName} idéal` : "Trouvez le produit qui vous correspond"),
    ctaText: "Découvrir ma sélection",
    industry: context.industry || sector?.label || "",
    axes: keptAxes,
    questions: kept.map((x) => x.b.question).filter((q) => q.answers.length <= GENERATION_LIMITS.maxAnswers),
  };
  return { draft, alternatives: alternatives.slice(0, 8), criteria, notes };
}

export const universalGenerator: DraftGenerator = {
  name: "universal",
  generate(context, options): ExpressProposal {
    const legacy = deterministicGenerator.generate(context, options);
    const fallback = (reason: string): ExpressProposal => ({
      ...legacy, analysis: { ...legacy.analysis, generator: "legacy", messages: [...legacy.analysis.messages, reason] },
    });
    if (!universalQuestionsEnabled()) return fallback("Les questions avancées ne sont pas activées : proposition classique.");
    let built: UniversalBuild | null;
    try { built = buildUniversalDraft(context, options); } catch { return fallback("La génération avancée a échoué : proposition classique."); }
    if (!built) return fallback("La génération avancée n'a trouvé aucun critère exploitable dans vos produits : proposition classique.");
    let validation;
    try { validation = validateExpressDraft(built.draft, context, { allowStrict: options.strictBudget === true }).validation; }
    catch (err) {
      if (err instanceof QuizError) return fallback("Le brouillon avancé n'a pas passé les contrôles de cohérence : proposition classique.");
      throw err;
    }
    const analysis: ExpressAnalysis = {
      ...legacy.analysis, generator: "universal", criteria: built.criteria, reliability: validation.reliability,
      messages: [
        ...(context.products.length === 0 ? legacy.analysis.messages : context.products.length < 3 ? legacy.analysis.messages.filter((m) => /produit/.test(m)) : []),
        ...built.notes, ...validation.warnings,
      ],
      missingForSector: [],
    };
    return { analysis, draft: built.draft, alternatives: built.alternatives };
  },
};
