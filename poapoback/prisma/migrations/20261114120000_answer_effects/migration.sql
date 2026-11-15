-- Additif et non destructif : colonne nullable sans valeur par défaut. Les réponses existantes restent à NULL (comportement inchangé).
ALTER TABLE "Answer" ADD COLUMN "effects" JSONB;
