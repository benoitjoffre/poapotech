export interface DashboardExperience {
  id: string;
  name: string;
  catalog: { id: string; name: string };
  accessible: boolean;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  correction: string | null;
  started: number;
  completed: number;
  productClicks: number;
}

export interface DashboardSummary {
  shop: { name: string | null; email: string; active: boolean };
  period: { from: string; to: string; days: number };
  totals: { started: number; completed: number; productClicks: number; accessible: number };
  products: number;
  catalogs: number;
  experiences: DashboardExperience[];
  nextAction: { kind: "draft" | "correction" | "create"; quizId: string | null };
}
