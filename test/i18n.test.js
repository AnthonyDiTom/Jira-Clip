// Tests de l'i18n léger — `node --test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../i18n.js");

test("setLang force fr/en et t() traduit", () => {
  I.setLang("fr");
  assert.equal(I.t("copyFailed"), "Échec de la copie");
  I.setLang("en");
  assert.equal(I.t("copyFailed"), "Copy failed");
});

test("t() interpole les variables", () => {
  I.setLang("en");
  assert.equal(I.t("copied", { text: "AB-1" }), "Copied: AB-1");
  assert.equal(I.t("ticketsOnPage", { n: 3 }), "3 tickets on this page");
});

test("clé inconnue : repli fr puis clé brute", () => {
  I.setLang("en");
  assert.equal(I.t("cléInexistante"), "cléInexistante");
});

test("parité des clés entre fr et en", () => {
  const fr = Object.keys(I.MESSAGES.fr).sort();
  const en = Object.keys(I.MESSAGES.en).sort();
  assert.deepEqual(fr, en);
});

test("setLang('auto') renvoie fr ou en", () => {
  const l = I.setLang("auto");
  assert.ok(l === "fr" || l === "en");
});
