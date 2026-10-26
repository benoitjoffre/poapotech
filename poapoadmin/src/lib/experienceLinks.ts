import type { DashboardExperience } from "@poapo/types";

export function quizPath(quiz: Pick<DashboardExperience, "id" | "catalog">, path = "/quizzes/"): string {
  const query = new URLSearchParams({ quizId: quiz.id, catalogId: quiz.catalog.id });
  return path === "/quizzes/" ? `${path}${encodeURIComponent(quiz.id)}?${query}` : `${path}?${query}`;
}

export function widgetBaseUrl(): string {
  return String(import.meta.env.VITE_WIDGET_BASE_URL ??
    (import.meta.env.PROD ? "https://app.poapo-tech.com" : "http://localhost:5173")).replace(/\/$/, "");
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

/** Assistant guidé de création, basé sur le quiz (aucune campagne requise). */
export function experienceSetupPath(quizId: string, step?: number): string {
  return `/experiences/${encodeURIComponent(quizId)}/setup${step ? `?step=${step}` : ""}`;
}
