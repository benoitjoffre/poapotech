import type { DashboardExperience } from "@poapo/types";

export function quizPath(quiz: Pick<DashboardExperience, "id" | "catalog">, path = "/quizzes/"): string {
  const query = new URLSearchParams({ quizId: quiz.id, catalogId: quiz.catalog.id });
  return path === "/quizzes/" ? `${path}${encodeURIComponent(quiz.id)}?${query}` : `${path}?${query}`;
}

export function publicQuizLink(tenantId: string, quizId: string): string {
  const base = String(import.meta.env.VITE_WIDGET_BASE_URL ??
    (import.meta.env.PROD ? "https://app.poapo-tech.com" : "http://localhost:5173")).replace(/\/$/, "");
  return `${base}/?${new URLSearchParams({ clientId: tenantId, quizId })}`;
}
