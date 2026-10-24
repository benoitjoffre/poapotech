import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_QUIZ_BACKGROUND, parseQuizTheme, QUIZ_FONTS, resolveQuizTheme } from "@poapo/types";

test("thème historique : héritage marque et valeurs du widget sans personnalisation", () => {
  const brand = { primaryColor: "#123456", logoUrl: "https://example.test/brand.png" };
  const theme = resolveQuizTheme(brand);
  assert.deepEqual(resolveQuizTheme(brand, null), theme);
  assert.deepEqual(resolveQuizTheme(brand, {}), theme);
  assert.equal(theme.primaryColor, brand.primaryColor);
  assert.equal(theme.logoUrl, brand.logoUrl);
  assert.equal(theme.background, LEGACY_QUIZ_BACKGROUND);
  assert.equal(theme.headingFamily, QUIZ_FONTS[0].family);
  assert.equal(theme.bodyFamily, QUIZ_FONTS[1].family);
  assert.equal(theme.textColor, "#1d1b22");
  assert.equal(theme.buttonRadius, "999px");
  assert.equal(theme.previousLabel, "Retour");
  assert.equal(theme.nextLabel, "Suivant");
  assert.equal(resolveQuizTheme({}).primaryColor, "#0d9488");
});

test("thème partiel et réinitialisation : les champs non définis suivent toujours la marque", () => {
  const custom = parseQuizTheme({ accentColor: "#ff7700", headingFont: "georgia", buttonShape: "square", nextLabel: " Continuer " });
  const theme = resolveQuizTheme({ primaryColor: "#123456" }, custom);
  assert.equal(theme.accentColor, "#FF7700");
  assert.equal(theme.primaryColor, "#123456");
  assert.equal(theme.bodyFont, "legacy-body");
  assert.equal(theme.buttonRadius, "0px");
  assert.equal(theme.nextLabel, "Continuer");
  assert.equal(resolveQuizTheme({ primaryColor: "#654321" }, custom).primaryColor, "#654321");
  assert.equal(resolveQuizTheme({ primaryColor: "#654321" }, null).accentColor, "#654321");
  assert.equal(parseQuizTheme({ primaryColor: null, headingFont: null }), null);
});

test("validation fermée du thème : couleurs, polices, styles, URL et libellés", () => {
  for (const input of [
    [], "css", { css: "body{}" }, { primaryColor: "red" }, { primaryColor: "#fff" },
    { primaryColor: "#ffffff;display:none" }, { primaryColor: 123 }, { bodyFont: "url(https://fonts.test)" },
    { headingFont: "Unknown" }, { buttonShape: "custom" }, { logoUrl: "javascript:alert(1)" },
    { logoUrl: "data:image/svg+xml,abc" }, { logoUrl: "/logo.png" }, { logoUrl: "https://user:pass@example.test/a" },
    { nextLabel: "" }, { nextLabel: "x".repeat(81) }, { submitLabel: "Test\nLabel" }, { restartLabel: 3 },
  ]) assert.throws(() => parseQuizTheme(input), JSON.stringify(input));
  assert.deepEqual(parseQuizTheme({ logoUrl: "https://example.test/logo.png", nextLabel: "Continuer" }), {
    logoUrl: "https://example.test/logo.png", nextLabel: "Continuer",
  });
});
