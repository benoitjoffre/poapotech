CREATE TABLE "QuizEditorDraft" (
    "quizId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuizEditorDraft_pkey" PRIMARY KEY ("quizId"),
    CONSTRAINT "QuizEditorDraft_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX "QuizEditorDraft_tenantId_idx" ON "QuizEditorDraft"("tenantId");
CREATE UNIQUE INDEX "QuizEditorDraft_tenantId_quizId_key" ON "QuizEditorDraft"("tenantId", "quizId");

ALTER TABLE "QuizEditorDraft" ADD CONSTRAINT "QuizEditorDraft_tenantId_quizId_fkey"
FOREIGN KEY ("tenantId", "quizId") REFERENCES "Quiz"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
