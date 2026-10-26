import type { QuizPublicationIssue } from "@poapo/types";

export type EditorSection = "configuration" | "products" | "questions" | "appearance" | "preview" | "publication";

export interface IssueTarget {
  section: EditorSection;
  /** Identifiant DOM du champ à focaliser ; absent = simple ouverture de la section. */
  elementId?: string;
}

interface ConfigShape {
  name: string;
  quizTitle: string;
  ctaText: string;
  axes: Array<{ label: string }>;
}

/** Les règles de validation restent côté serveur : ce module ne fait que localiser un diagnostic existant dans l'éditeur. */
export function issueTarget(issue: QuizPublicationIssue, config: ConfigShape | null | undefined): IssueTarget | null {
  const message = issue.message;
  switch (issue.code) {
    case "NO_PRODUCTS": return { section: "products", elementId: "quiz-use-all-products" };
    case "MISSING_ATTRIBUTES":
    case "MISSING_EMBEDDINGS": return { section: "products", elementId: "xe-products-title" };
    case "INVALID_CONFIG": {
      const empty = [["quiz-name", config?.name], ["quiz-title", config?.quizTitle], ["quiz-cta", config?.ctaText]]
        .find(([, value]) => !String(value ?? "").trim());
      return { section: "configuration", elementId: empty ? empty[0] : "quiz-name" };
    }
    case "WEAK_AXIS": {
      const label = /«\s*(.+?)\s*»/.exec(message)?.[1];
      const index = config?.axes.findIndex((axis) => axis.label === label) ?? -1;
      return { section: "configuration", elementId: index >= 0 ? `axis-label-${index}` : undefined };
    }
    case "NO_AXES": return { section: "configuration", elementId: "quiz-add-axis" };
    case "LOW_CONTRAST": return { section: "appearance", elementId: "quiz-theme-primaryColor" };
    case "SHARED_QUIZ": return null;
    default: break;
  }
  if (issue.section === "questions") return { section: "questions", elementId: issue.questionId ? `editor-question-${issue.questionId}` : undefined };
  if (issue.section === "appearance") return { section: "appearance", elementId: /logo/i.test(message) ? "quiz-theme-logo" : undefined };
  if (issue.section === "configuration") {
    if (/catalogue/i.test(message)) return { section: "configuration", elementId: "quiz-catalog" };
    if (/produit/i.test(message)) return { section: "products", elementId: "quiz-use-all-products" };
    return { section: "configuration" };
  }
  return null;
}
