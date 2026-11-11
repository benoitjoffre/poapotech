import type { DashboardExperience } from "@poapo/types";

export function quizPath(quiz: Pick<DashboardExperience, "id" | "catalog">, path = "/quizzes/"): string {
  if (path === "/quizzes/") return experienceEditorPath(quiz.id);
  if (path === "/quiz-builder") return experienceEditorPath(quiz.id, "questions");
  const query = new URLSearchParams({ quizId: quiz.id, catalogId: quiz.catalog.id });
  return path === "/quizzes/" ? `${path}${encodeURIComponent(quiz.id)}?${query}` : `${path}?${query}`;
}

export function widgetBaseUrl(): string {
  // VITE_WIDGET_BASE_URL est obligatoire au build de production ; le repli local n'existe qu'en développement.
  return String(import.meta.env.VITE_WIDGET_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:5173" : "")).replace(/\/$/, "");
}

export function publicQuizLink(tenantId: string, quizId: string): string {
  const base = widgetBaseUrl();
  return `${base}/?${new URLSearchParams({ clientId: tenantId, quizId })}`;
}

/** Éditeur unifié basé sur le quiz : aucune campagne requise. */
export function experienceEditorPath(quizId: string, section?: string): string {
  return `/experiences/${encodeURIComponent(quizId)}/edit${section ? `?section=${encodeURIComponent(section)}` : ""}`;
}

/** Éditeur historique ouvert depuis une campagne (Campaign Studio). */
export function campaignEditorPath(campaignId: string): string {
  return `/campaigns/${encodeURIComponent(campaignId)}/quiz-editor`;
}

export function embedSnippet(tenantId: string, quizId: string): string {
  const base = widgetBaseUrl();
  return `<script src="${base}/poapo-widget.js" data-url="${base}" data-client-id="${tenantId}" data-quiz-id="${quizId}" async></script>`;
}
