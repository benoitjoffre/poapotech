import { useState, type CSSProperties } from "react";
import {
  isQuizThemeColor, QUIZ_BUTTON_SHAPES, QUIZ_FONTS, resolveQuizTheme,
  type QuizBranding, type QuizTheme,
} from "@poapo/types";
import type { QuizEditorSession } from "../hooks/useQuizEditorDraft";

const COLORS = [
  { key: "primaryColor", label: "Couleur principale" },
  { key: "secondaryColor", label: "Couleur secondaire" },
  { key: "accentColor", label: "Couleur d'accent" },
  { key: "backgroundColor", label: "Couleur de fond" },
  { key: "textColor", label: "Couleur du texte" },
] as const;
const LABELS = [
  { key: "startLabel", label: "Démarrer le quiz" },
  { key: "previousLabel", label: "Retour à la question précédente" },
  { key: "nextLabel", label: "Question suivante" },
  { key: "submitLabel", label: "Envoi des réponses" },
  { key: "restartLabel", label: "Recommencer le quiz" },
] as const;

function PreviewLogo({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="appearance-logo-error" role="status">Logo non chargé. Vérifiez l'URL et son accessibilité.</p>;
  return <img className="appearance-preview-logo" src={url} alt="Logo du quiz" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export default function QuizAppearancePanel({ editor, branding, disabled, error, visible }: {
  editor: QuizEditorSession;
  branding: QuizBranding;
  disabled: boolean;
  error: string;
  visible: boolean;
}) {
  const theme = editor.draft?.theme;
  const inherited = resolveQuizTheme(branding);
  const effective = resolveQuizTheme(branding, error ? null : theme);
  function change<K extends keyof QuizTheme>(key: K, value: QuizTheme[K]) {
    editor.setDraft((draft) => draft ? { ...draft, theme: { ...draft.theme, [key]: value } } : draft);
  }
  const previewStyle: CSSProperties & Record<string, string> = {
    "--quiz-primary": effective.primaryColor,
    "--quiz-secondary": effective.secondaryColor,
    "--quiz-accent": effective.accentColor,
    "--quiz-background": effective.background,
    "--quiz-text": effective.textColor,
    "--quiz-heading-font": effective.headingFamily,
    "--quiz-body-font": effective.bodyFamily,
    "--quiz-button-radius": effective.buttonRadius,
  };
  const question = editor.draft?.questions.find((item) => item.active);

  return <section id="editor-panel-appearance" role="tabpanel" aria-labelledby="editor-tab-appearance"
    hidden={!visible} className="quiz-editor-panel appearance-layout">
    <fieldset disabled={disabled} className="appearance-controls">
      <legend className="page-title">Identité visuelle du quiz</legend>
      <p className="section-hint">Chaque champ vide hérite du thème de la marque ou du style actuel du quiz.
        Les changements restent dans ce brouillon, sans modifier les autres quiz.</p>
      <section className="appearance-section">
        <h3>Logo</h3>
        <label className="field-label" htmlFor="quiz-theme-logo">URL du logo du quiz</label>
        <input className="field-input" id="quiz-theme-logo" type="url" maxLength={2048}
          value={theme?.logoUrl ?? ""} placeholder={branding.logoUrl || "https://votre-site.fr/logo.png"}
          onChange={(event) => change("logoUrl", event.target.value || undefined)}
          aria-describedby="quiz-logo-hint" />
        <p id="quiz-logo-hint" className="field-hint">URL HTTP ou HTTPS. Vide : logo de la marque. Aucun fichier n'est envoyé.</p>
        {theme?.logoUrl && <button type="button" className="btn-ghost btn-sm" onClick={() => change("logoUrl", undefined)}>Utiliser le logo de la marque</button>}
      </section>
      <section className="appearance-section">
        <h3>Couleurs</h3>
        {COLORS.map(({ key, label }) => {
          const value = theme?.[key] ?? "";
          const invalid = !!value && !isQuizThemeColor(value);
          return <div className="appearance-color-field" key={key}>
            <label className="field-label" htmlFor={`quiz-theme-${key}`}>{label}
              <span className="appearance-inheritance">{value ? "Personnalisée" : "Héritée"}</span>
            </label>
            <div className="appearance-color-inputs">
              <input type="color" aria-label={`${label} (sélecteur)`}
                value={isQuizThemeColor(value) ? value : isQuizThemeColor(effective[key]) ? effective[key] : "#6C47FF"}
                onChange={(event) => change(key, event.target.value)} />
              <input className="field-input" id={`quiz-theme-${key}`} aria-label={`${label} (hexadécimal)`}
                value={value} placeholder={effective[key]} maxLength={7} spellCheck={false}
                aria-invalid={invalid} aria-describedby={invalid ? "theme-validation-error" : undefined}
                onChange={(event) => change(key, event.target.value || undefined)} />
              <button type="button" className="btn-ghost btn-sm" disabled={!value} aria-label={`Hériter : ${label}`}
                onClick={() => change(key, undefined)}>Hériter</button>
            </div>
          </div>;
        })}
        <p className="field-hint">Format #RRGGBB. Sans couleur de fond personnalisée, le dégradé historique est conservé.
          Vérifiez le contraste de vos textes et boutons dans l'aperçu.</p>
      </section>
      <section className="appearance-section">
        <h3>Typographies</h3>
        {(["headingFont", "bodyFont"] as const).map((key) => <div className="field-group" key={key}>
          <label className="field-label" htmlFor={`quiz-theme-${key}`}>{key === "headingFont" ? "Police des titres" : "Police du contenu"}</label>
          <select className="field-select" id={`quiz-theme-${key}`} value={theme?.[key] ?? ""}
            onChange={(event) => change(key, QUIZ_FONTS.find((font) => font.id === event.target.value)?.id)}>
            <option value="">Hériter du style actuel</option>
            {QUIZ_FONTS.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}
          </select>
        </div>)}
        <p className="field-hint">Polices locales prédéfinies avec repli système. Aucun téléchargement de police ni CSS libre.</p>
      </section>
      <section className="appearance-section">
        <h3>Boutons</h3>
        <label className="field-label" htmlFor="quiz-theme-buttonShape">Forme des boutons</label>
        <select className="field-select" id="quiz-theme-buttonShape" value={theme?.buttonShape ?? ""}
          onChange={(event) => change("buttonShape", QUIZ_BUTTON_SHAPES.find((shape) => shape.id === event.target.value)?.id)}>
          <option value="">Hériter du style actuel (arrondis)</option>
          {QUIZ_BUTTON_SHAPES.map((shape) => <option value={shape.id} key={shape.id}>{shape.label}</option>)}
        </select>
        {LABELS.map(({ key, label }) => <div className="field-group" key={key}>
          <label className="field-label" htmlFor={`quiz-theme-${key}`}>{label}</label>
          <input className="field-input" id={`quiz-theme-${key}`} value={theme?.[key] ?? ""} maxLength={80}
            placeholder={inherited[key]} onChange={(event) => change(key, event.target.value || undefined)} />
        </div>)}
        <p className="field-hint">Ces libellés correspondent aux étapes existantes. Le bouton de recommandation produit reste défini dans la configuration du quiz.</p>
      </section>
      <button type="button" className="btn-ghost appearance-reset" onClick={() => {
        if (confirm("Réinitialiser uniquement l'apparence au thème de la marque ? Enregistrez ensuite le brouillon pour conserver ce choix.")) {
          editor.setDraft((draft) => draft ? { ...draft, theme: null } : draft);
        }
      }}>Réinitialiser au thème de la marque</button>
    </fieldset>

    <aside className="appearance-preview" aria-label="Aperçu graphique du quiz">
      <div className="appearance-preview-heading">
        <h2>Aperçu visuel</h2><span className="quiz-editor-coming-badge">Brouillon</span>
      </div>
      <p className="section-hint">Présentation graphique uniquement. Le parcours interactif et les recommandations ne sont pas exécutés.</p>
      {error && <p className="form-error">Corrigez les champs invalides. L'aperçu affiche temporairement le thème de la marque.</p>}
      <div className="appearance-preview-frame" style={previewStyle}>
        <div className="appearance-preview-brand">
          {effective.logoUrl ? <PreviewLogo key={effective.logoUrl} url={effective.logoUrl} /> : <strong>{branding.name || "Votre marque"}</strong>}
        </div>
        <h3>{editor.draft?.config.quizTitle || "Votre quiz"}</h3>
        <p>Découvrez la sélection qui vous correspond.</p>
        <span className="appearance-preview-button">{effective.startLabel}</span>
        <div className="appearance-preview-progress"><span /></div>
        <section className="appearance-preview-question">
          <h4>{question?.text || "Quelle expérience vous correspond ?"}</h4>
          {(question?.answers.length ? question.answers.slice(0, 3).map((answer) => `${answer.emoji || ""} ${answer.text}`.trim()) :
            ["Une première inspiration", "Une autre envie", "Une découverte"]).map((label, index) =>
              <div className={`appearance-preview-option${index === 0 ? " selected" : ""}`} key={index}>
                <span aria-hidden="true">{index === 0 ? "●" : "○"}</span>{label}
              </div>)}
          <div className="appearance-preview-navigation">
            <span className="appearance-preview-button secondary">{effective.previousLabel}</span>
            <span className="appearance-preview-button">{effective.nextLabel}</span>
          </div>
        </section>
        <span className="appearance-preview-button">{effective.submitLabel}</span>
        <span className="appearance-preview-button secondary">{effective.restartLabel}</span>
      </div>
      <p className="field-hint">Les boutons de cette maquette ne sont pas interactifs. Aucun événement ni recommandation n'est envoyé.</p>
    </aside>
  </section>;
}
