import { resolveQuizTheme, type QuizBranding, type QuizTheme } from "@poapo/types";

/** No style element at all for historical quizzes without overrides. */
export default function QuizThemeStyle({ branding, theme }: { branding: QuizBranding; theme?: QuizTheme | null }) {
  if (!theme || !Object.keys(theme).length) return null;
  const effective = resolveQuizTheme(branding, theme);
  return <style>{`
    ${theme.primaryColor ? `:root { --primary-color: ${effective.primaryColor}; }` : ""}
    ${theme.backgroundColor ? `body { background: ${effective.background}; }` : ""}
    ${theme.bodyFont ? `#root { font-family: ${effective.bodyFamily}; }` : ""}
    ${theme.textColor ? `#root, .intro p, .question-title, .question-help-text, .option, .result-description, .result-explanation, .summary-label, .summary-value { color: ${effective.textColor}; }` : ""}
    ${theme.headingFont ? `.title, .question-title, .result-hero-name { font-family: ${effective.headingFamily}; }` : ""}
    ${theme.accentColor ? `.title-accent { color: ${effective.accentColor}; } .progress-fill, .metric-bar span { background: ${effective.accentColor}; }` : ""}
    ${theme.buttonShape ? `.submit, .secondary, .result-restart-btn, .result-cta-btn { border-radius: ${effective.buttonRadius}; }` : ""}
    ${theme.secondaryColor ? `.secondary, .result-restart-btn { background: ${effective.secondaryColor}; }` : ""}
  `}</style>;
}
