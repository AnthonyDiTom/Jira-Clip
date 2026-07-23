// Tests de la logique d'extraction pure (extract-core.js) — `node --test`.
// Le DOM est simulé avec jsdom : on charge des fixtures HTML représentatives
// (test/fixtures/) et on fournit une URL de page réaliste. extract-core ne
// touche jamais aux globales document/location : tout passe par (doc, loc).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const X = require("../extract-core.js");

// Charge une fixture et renvoie { doc, loc } pour l'URL donnée.
function fromFixture(name, url) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  const dom = new JSDOM(html, { url });
  return { doc: dom.window.document, loc: dom.window.location };
}

// Construit { doc, loc } à partir d'un fragment HTML inline (cas limites).
function fromHtml(body, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, {
    url: url || "https://acme.atlassian.net/",
  });
  return { doc: dom.window.document, loc: dom.window.location };
}

// ---- Ticket trouvé : vue Jira récente -----------------------------------
test("extract: vue moderne — tous les champs extraits", () => {
  const { doc, loc } = fromFixture(
    "issue-modern.html",
    "https://acme.atlassian.net/browse/DEMO-1234"
  );
  const data = X.extract(doc, loc);
  assert.equal(data.ok, true);
  assert.equal(data.key, "DEMO-1234");
  assert.equal(data.title, "Corriger l'échec de connexion");
  assert.equal(data.type, "Bug");
  assert.equal(data.status, "In Progress");
  assert.equal(data.assignee, "Alex Demo");
  assert.equal(data.priority, "High");
  assert.equal(data.project, "DEMO");
  assert.equal(data.url, "https://acme.atlassian.net/browse/DEMO-1234");
});

// ---- Ticket trouvé : sélecteurs alternatifs -----------------------------
test("extract: variante — clé via ?selectedIssue, champs en texte", () => {
  const { doc, loc } = fromFixture(
    "issue-variant.html",
    "https://acme.atlassian.net/jira/software/projects/DEMO/boards/1?selectedIssue=DEMO-42"
  );
  const data = X.extract(doc, loc);
  assert.equal(data.ok, true);
  assert.equal(data.key, "DEMO-42");
  assert.equal(data.title, "Ajouter le bouton d'export");
  assert.equal(data.type, "Story");
  assert.equal(data.status, "Done");
  assert.equal(data.assignee, "Sam Variant");
  assert.equal(data.priority, "Low"); // le libellé « Priority » (heading) est ignoré
  assert.equal(data.url, "https://acme.atlassian.net/browse/DEMO-42");
});

test("findKey: URL /browse prioritaire, puis query, puis titre, puis DOM", () => {
  // 1) URL /browse
  let { doc, loc } = fromHtml("", "https://acme.atlassian.net/browse/AB-1");
  assert.equal(X.findKey(doc, loc), "AB-1");
  // 2) paramètre de requête
  ({ doc, loc } = fromHtml("", "https://acme.atlassian.net/x?issueKey=CD-22"));
  assert.equal(X.findKey(doc, loc), "CD-22");
  // 4) repli DOM : lien /browse (aucune clé dans l'URL/titre)
  ({ doc, loc } = fromHtml(
    '<a href="/browse/EF-3">voir</a>',
    "https://acme.atlassian.net/dashboard"
  ));
  assert.equal(X.findKey(doc, loc), "EF-3");
});

test("findKey: clé issue du titre de l'onglet", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head><title>[GH-9] Titre - Jira</title></head><body></body></html>",
    { url: "https://acme.atlassian.net/dashboard" }
  );
  assert.equal(X.findKey(dom.window.document, dom.window.location), "GH-9");
});

// ---- Titre absent --------------------------------------------------------
test("findTitle: repli sur le titre de l'onglet quand le DOM n'a pas de summary", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head><title>[DEMO-7] Mon titre - Jira</title></head><body></body></html>",
    { url: "https://acme.atlassian.net/browse/DEMO-7" }
  );
  const title = X.findTitle(dom.window.document, "DEMO-7");
  assert.equal(title, "Mon titre");
});

test("findTitle: renvoie null quand aucun titre n'est disponible", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head><title></title></head><body></body></html>",
    { url: "https://acme.atlassian.net/browse/DEMO-7" }
  );
  assert.equal(X.findTitle(dom.window.document, "DEMO-7"), null);
});

test("extract: ticket trouvé mais titre/champs absents → champs vides, ok", () => {
  // Clé détectable via l'URL, mais body vide et titre d'onglet sans texte utile.
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head><title></title></head><body></body></html>",
    { url: "https://acme.atlassian.net/browse/DEMO-99" }
  );
  const data = X.extract(dom.window.document, dom.window.location);
  assert.equal(data.ok, true);
  assert.equal(data.key, "DEMO-99");
  assert.equal(data.title, "");
  assert.equal(data.type, "");
  assert.equal(data.status, "");
  assert.equal(data.assignee, "");
  assert.equal(data.priority, "");
  assert.equal(data.project, "DEMO");
});

// ---- Repli propre (pas d'exception) -------------------------------------
test("extract: aucune clé détectable → { ok: false, error }", () => {
  const { doc, loc } = fromHtml(
    "<p>page quelconque sans ticket</p>",
    "https://acme.atlassian.net/dashboard"
  );
  const data = X.extract(doc, loc);
  assert.equal(data.ok, false);
  assert.ok(data.error && data.error.length > 0);
});

test("extract: robuste face à un doc/loc absent (ne lève pas)", () => {
  assert.doesNotThrow(() => X.extract(null, null));
  assert.equal(X.extract(null, null).ok, false);
  assert.doesNotThrow(() => X.extract(undefined, {}));
});

test("extractFor: clé fournie ≠ clé de la page → champs vides mais URL construite", () => {
  const { doc, loc } = fromFixture(
    "issue-modern.html",
    "https://acme.atlassian.net/browse/DEMO-1234"
  );
  // On demande une autre clé que celle de la page : on ne lit pas son DOM.
  const data = X.extractFor(doc, loc, "OTHER-5");
  assert.equal(data.ok, true);
  assert.equal(data.key, "OTHER-5");
  assert.equal(data.title, "");
  assert.equal(data.type, "");
  assert.equal(data.url, "https://acme.atlassian.net/browse/OTHER-5");
  assert.equal(data.project, "OTHER");
});

test("emptyResult: forme de repli cohérente", () => {
  const r = X.emptyResult("ZZ-1", "https://x/browse/ZZ-1");
  assert.deepEqual(r, {
    ok: true,
    key: "ZZ-1",
    title: "",
    url: "https://x/browse/ZZ-1",
    type: "",
    status: "",
    assignee: "",
    priority: "",
    project: "ZZ",
    parentKey: "",
  });
});

// ---- Extraction multi-tickets -------------------------------------------
test("extractMultiple: cartes de board, avec déduplication", () => {
  const { doc, loc } = fromFixture(
    "board.html",
    "https://acme.atlassian.net/jira/software/projects/DEMO/boards/1"
  );
  const tickets = X.extractMultiple(doc, loc);
  assert.deepEqual(tickets, [
    {
      key: "DEMO-1",
      title: "Mettre en place l'authentification",
      url: "https://acme.atlassian.net/browse/DEMO-1",
    },
    {
      key: "DEMO-2",
      title: "[FRONT] Refondre la page d'accueil",
      url: "https://acme.atlassian.net/browse/DEMO-2",
    },
    {
      key: "DEMO-3",
      title: "Corriger le tri des colonnes",
      url: "https://acme.atlassian.net/browse/DEMO-3",
    },
  ]);
});

test("extractMultiple: repli sur les liens /browse quand aucune carte", () => {
  const { doc, loc } = fromHtml(
    '<a href="/browse/AB-1">AB-1 Un</a><a href="/browse/AB-2">AB-2 Deux</a>',
    "https://acme.atlassian.net/issues"
  );
  const tickets = X.extractMultiple(doc, loc);
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].key, "AB-1");
  assert.equal(tickets[1].url, "https://acme.atlassian.net/browse/AB-2");
});

test("extractMultiple: aucune correspondance → tableau vide (pas d'exception)", () => {
  const { doc, loc } = fromHtml("<p>rien</p>", "https://acme.atlassian.net/x");
  assert.deepEqual(X.extractMultiple(doc, loc), []);
});
