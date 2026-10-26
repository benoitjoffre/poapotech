export const QUIZ_FONTS = [
  { id: "legacy-title", label: "Éditorial (titres actuels)", family: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", serif' },
  { id: "legacy-body", label: "Inter / système (contenu actuel)", family: '"Inter", system-ui, sans-serif' },
  { id: "system", label: "Système", family: "system-ui, sans-serif" },
  { id: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", family: "Georgia, serif" },
  { id: "trebuchet", label: "Trebuchet", family: '"Trebuchet MS", sans-serif' },
  { id: "verdana", label: "Verdana", family: "Verdana, sans-serif" },
] as const;

export type QuizFont = typeof QUIZ_FONTS[number]["id"];
export const QUIZ_BUTTON_SHAPES = [
  { id: "rounded", label: "Arrondis", radius: "999px" },
  { id: "soft", label: "Légèrement arrondis", radius: "8px" },
  { id: "square", label: "Carrés", radius: "0px" },
] as const;
export type QuizButtonShape = typeof QUIZ_BUTTON_SHAPES[number]["id"];
export const QUIZ_THEME_COLORS = ["primaryColor", "secondaryColor", "accentColor", "backgroundColor", "textColor"] as const;
export const QUIZ_NAVIGATION_LABELS = ["startLabel", "previousLabel", "nextLabel", "submitLabel", "restartLabel"] as const;

/** Missing/null fields inherit the brand and historical widget defaults. */
export interface QuizTheme {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  headingFont?: QuizFont | null;
  bodyFont?: QuizFont | null;
  buttonShape?: QuizButtonShape | null;
  startLabel?: string | null;
  previousLabel?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  restartLabel?: string | null;
}

export interface QuizBranding {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export function isQuizThemeColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** Allowlisted values only: no CSS, font URLs, data URLs or arbitrary properties. */
export function parseQuizTheme(raw: unknown): QuizTheme | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Thème du quiz invalide");
  const input = raw as Record<string, unknown>;
  const allowed = new Set<string>([...QUIZ_THEME_COLORS, ...QUIZ_NAVIGATION_LABELS, "logoUrl", "headingFont", "bodyFont", "buttonShape"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Paramètre de thème non autorisé : ${key}`);
  }
  const theme: QuizTheme = {};
  for (const key of QUIZ_THEME_COLORS) {
    const value = input[key];
    if (value == null) continue;
    if (typeof value !== "string" || !isQuizThemeColor(value)) throw new Error(`Couleur ${key} invalide : utilisez #RRGGBB`);
    theme[key] = value.toUpperCase();
  }
  for (const key of ["headingFont", "bodyFont"] as const) {
    const value = input[key];
    if (value == null) continue;
    const font = QUIZ_FONTS.find((item) => item.id === value);
    if (!font) throw new Error(`Typographie ${key} non autorisée`);
    theme[key] = font.id;
  }
  if (input.buttonShape != null) {
    const shape = QUIZ_BUTTON_SHAPES.find((item) => item.id === input.buttonShape);
    if (!shape) throw new Error("Forme de bouton non autorisée");
    theme.buttonShape = shape.id;
  }
  if (input.logoUrl != null) {
    if (typeof input.logoUrl !== "string" || input.logoUrl.length > 2048) throw new Error("URL du logo invalide");
    let url: URL;
    try { url = new URL(input.logoUrl); }
    catch { throw new Error("URL du logo invalide : utilisez une URL HTTP ou HTTPS absolue"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("URL du logo invalide : seuls HTTP et HTTPS sans identifiants sont autorisés");
    }
    theme.logoUrl = url.href;
  }
  for (const key of QUIZ_NAVIGATION_LABELS) {
    const value = input[key];
    if (value == null) continue;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`Libellé ${key} invalide : entre 1 et 80 caractères`);
    }
    theme[key] = value.trim();
  }
  return Object.keys(theme).length ? theme : null;
}

/** Couleur de repli officielle POAPO. */
export const DEFAULT_PRIMARY_COLOR = "#6C47FF";

export const LEGACY_QUIZ_BACKGROUND = "radial-gradient(600px circle at center, rgba(16, 185, 129, 0.08), transparent 70%), radial-gradient(circle at top, #f7e9f7 0%, #f3f5fb 45%, #ffffff 100%)";

/** Draft preview only until controlled publication exists. Never changes public CSS. */
export function resolveQuizTheme(branding: QuizBranding, theme?: QuizTheme | null) {
  const primaryColor = theme?.primaryColor ?? branding.primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const headingFont = theme?.headingFont ?? "legacy-title";
  const bodyFont = theme?.bodyFont ?? "legacy-body";
  const buttonShape = theme?.buttonShape ?? "rounded";
  return {
    logoUrl: theme?.logoUrl ?? branding.logoUrl ?? null,
    primaryColor,
    secondaryColor: theme?.secondaryColor ?? "#ffffff",
    accentColor: theme?.accentColor ?? primaryColor,
    backgroundColor: theme?.backgroundColor ?? "#f3f5fb",
    background: theme?.backgroundColor ?? LEGACY_QUIZ_BACKGROUND,
    textColor: theme?.textColor ?? "#1d1b22",
    headingFont, bodyFont, buttonShape,
    headingFamily: QUIZ_FONTS.find((font) => font.id === headingFont)!.family,
    bodyFamily: QUIZ_FONTS.find((font) => font.id === bodyFont)!.family,
    buttonRadius: QUIZ_BUTTON_SHAPES.find((shape) => shape.id === buttonShape)!.radius,
    startLabel: theme?.startLabel ?? "Commencer le quiz",
    previousLabel: theme?.previousLabel ?? "Retour",
    nextLabel: theme?.nextLabel ?? "Suivant",
    submitLabel: theme?.submitLabel ?? "Envoyer mes reponses",
    restartLabel: theme?.restartLabel ?? "Recommencer le quiz",
  };
}
