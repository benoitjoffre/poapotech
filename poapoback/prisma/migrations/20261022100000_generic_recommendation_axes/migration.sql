BEGIN;

-- Axes numériques définis par quiz. Les quiz existants reprennent les clés
-- numériques déjà utilisées par les impacts de leurs réponses.
ALTER TABLE "Quiz" ADD COLUMN "axes" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "Quiz" q
SET "axes" = derived.axes
FROM (
  SELECT keys."quizId",
         jsonb_agg(jsonb_build_object('key', keys.key, 'label', keys.key) ORDER BY keys.key) AS axes
  FROM (
    SELECT DISTINCT qu."quizId", e.key
    FROM "Question" qu
    JOIN "Answer" a ON a."questionId" = qu.id
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(a.impacts) = 'object' THEN a.impacts ELSE '{}'::jsonb END
    ) e
    WHERE jsonb_typeof(e.value) = 'number'
  ) keys
  GROUP BY keys."quizId"
) derived
WHERE derived."quizId" = q.id;

-- Les anciennes colonnes spécifiques deviennent des attributs produit, sans perte.
-- Les attributs déjà présents sont prioritaires en cas de collision.
UPDATE "Product"
SET "attributes" = jsonb_strip_nulls(jsonb_build_object(
    'freshness', "freshness",
    'intensity', "intensity",
    'sweetness', "sweetness",
    'olfactoryFamily', "olfactoryFamily",
    'subFamily', "subFamily",
    'concentration', "concentration"::text,
    'genderTarget', "genderTarget"::text,
    'priceTier', "priceTier"::text,
    'topNotes', CASE WHEN cardinality("topNotes") > 0 THEN to_jsonb("topNotes") END,
    'heartNotes', CASE WHEN cardinality("heartNotes") > 0 THEN to_jsonb("heartNotes") END,
    'baseNotes', CASE WHEN cardinality("baseNotes") > 0 THEN to_jsonb("baseNotes") END,
    'seasons', CASE WHEN cardinality("seasons") > 0 THEN to_jsonb("seasons"::text[]) END,
    'occasions', CASE WHEN cardinality("occasions") > 0 THEN to_jsonb("occasions"::text[]) END,
    'timeOfDay', CASE WHEN cardinality("timeOfDay") > 0 THEN to_jsonb("timeOfDay"::text[]) END
  )) || COALESCE("attributes", '{}'::jsonb);

ALTER TABLE "Product"
  DROP COLUMN "priceTier",
  DROP COLUMN "concentration",
  DROP COLUMN "topNotes",
  DROP COLUMN "heartNotes",
  DROP COLUMN "baseNotes",
  DROP COLUMN "olfactoryFamily",
  DROP COLUMN "subFamily",
  DROP COLUMN "genderTarget",
  DROP COLUMN "freshness",
  DROP COLUMN "intensity",
  DROP COLUMN "sweetness",
  DROP COLUMN "seasons",
  DROP COLUMN "occasions",
  DROP COLUMN "timeOfDay";

ALTER TABLE "QuizSession"
  DROP COLUMN "gender",
  DROP COLUMN "mood";

DROP TYPE "GenderTarget";
DROP TYPE "PriceTier";
DROP TYPE "Concentration";
DROP TYPE "Season";
DROP TYPE "Occasion";
DROP TYPE "TimeOfDay";

ALTER TABLE "Answer" ALTER COLUMN "impacts" SET DEFAULT '{}'::jsonb;

-- L'activité devient un libellé libre : les anciens codes de secteur sont convertis en libellés.
UPDATE "Tenant" SET "industry" = CASE "industry"
  WHEN 'perfume' THEN 'Parfumerie'
  WHEN 'coffee' THEN 'Café'
  WHEN 'fashion' THEN 'Mode'
  WHEN 'food' THEN 'Alimentaire'
  WHEN 'custom' THEN ''
  ELSE "industry" END;
UPDATE "Quiz" SET "industry" = CASE "industry"
  WHEN 'perfume' THEN 'Parfumerie'
  WHEN 'coffee' THEN 'Café'
  WHEN 'fashion' THEN 'Mode'
  WHEN 'food' THEN 'Alimentaire'
  WHEN 'custom' THEN ''
  ELSE "industry" END;

ALTER TABLE "Tenant" ALTER COLUMN "industry" SET DEFAULT '';
ALTER TABLE "Tenant" ALTER COLUMN "quizTitle" SET DEFAULT 'Trouve ton produit idéal';
ALTER TABLE "Tenant" ALTER COLUMN "ctaText" SET DEFAULT 'Découvrir ma sélection';
ALTER TABLE "Quiz" ALTER COLUMN "industry" SET DEFAULT '';

COMMIT;
