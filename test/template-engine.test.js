// Tests de la logique pure (template-engine.js) — exécutés avec `node --test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../template-engine.js");

const SAMPLE = {
  key: "DEMO-1234",
  title: "Corriger l'échec de connexion (été)",
  url: "https://jira.example.com/browse/DEMO-1234",
  type: "Bug",
  status: "In Progress",
  assignee: "Alex Demo",
  priority: "High",
};
const OPTS = {
  branchPrefixes: { bug: "bugfix/", default: "feature/" },
  commitTypes: { bug: "fix", default: "feat" },
  now: new Date(2026, 6, 18), // 2026-07-18 (mois 0-indexé)
};

test("slugify retire accents, met en minuscules, joint par des tirets", () => {
  assert.equal(T.slugify("Corriger l'échec (été) !"), "corriger-l-echec-ete");
  assert.equal(T.slugify(""), "");
  assert.equal(T.slugify("A_B c"), "a-b-c");
});

test("escapeMarkdown échappe les métacaractères en ligne", () => {
  assert.equal(T.escapeMarkdown("a*b_c[d]"), "a\\*b\\_c\\[d\\]");
});

test("escapeHtml échappe &<>\"", () => {
  assert.equal(T.escapeHtml('a & b <c> "d"'), "a &amp; b &lt;c&gt; &quot;d&quot;");
});

test("stripKeyPrefix retire la clé et les séparateurs en tête", () => {
  assert.equal(T.stripKeyPrefix("DEMO-1234 Titre", "DEMO-1234"), "Titre");
  assert.equal(T.stripKeyPrefix("[DEMO-1234] : Titre", "DEMO-1234"), "Titre");
  assert.equal(T.stripKeyPrefix("Titre sans clé", "DEMO-1234"), "Titre sans clé");
});

test("cleanTitle: sans motif, renvoie le titre inchangé", () => {
  assert.equal(T.cleanTitle("Mon titre", []), "Mon titre");
  assert.equal(T.cleanTitle("Mon titre"), "Mon titre");
  assert.equal(T.cleanTitle("  espaces  bruts ", []), "  espaces  bruts ");
});

test("cleanTitle: motif brut (regex, casse ignorée) retiré partout", () => {
  assert.equal(T.cleanTitle("[FRONT] Corriger le bug", ["\\[[^\\]]+\\]"]), "Corriger le bug");
  assert.equal(T.cleanTitle("WIP: tâche", ["wip:?"]), "tâche");
  assert.equal(T.cleanTitle("a X b X c", ["x"]), "a b c");
});

test("cleanTitle: forme /motif/flags respectée", () => {
  // Sans le flag i, "WIP" majuscule reste ; "wip" minuscule serait retiré.
  assert.equal(T.cleanTitle("WIP: réel", ["/wip:?/"]), "WIP: réel");
  assert.equal(T.cleanTitle("wip: réel", ["/wip:?/"]), "réel");
  // Ancrage début de ligne conservé.
  assert.equal(T.cleanTitle("bug bug", ["/^bug/"]), "bug");
});

test("cleanTitle: motifs invalides ou vides ignorés", () => {
  assert.equal(T.cleanTitle("Titre (x", ["("]), "Titre (x"); // regex invalide
  assert.equal(T.cleanTitle("Titre", ["//"]), "Titre"); // corps vide
  assert.equal(T.cleanTitle("Titre", ["", "   ", null]), "Titre");
});

test("findInvalidCleanups: signale les regex invalides avec ligne + motif", () => {
  const bad = T.findInvalidCleanups(["wip:?", "(", "\\[[^\\]]+\\]", "a[b"]);
  assert.deepEqual(bad, [
    { line: 2, pattern: "(" },
    { line: 4, pattern: "a[b" },
  ]);
});

test("findInvalidCleanups: lignes vides/ignorées ne sont pas des erreurs", () => {
  assert.deepEqual(T.findInvalidCleanups(["", "   ", "//", null, "wip:?"]), []);
  assert.deepEqual(T.findInvalidCleanups([]), []);
  assert.deepEqual(T.findInvalidCleanups("pas un tableau"), []);
});

test("findInvalidCleanups: numéros de ligne alignés sur les lignes brutes", () => {
  // La ligne 3 (index 2) est vide : la regex invalide est donc en ligne 4.
  const bad = T.findInvalidCleanups(["ok", "wip:?", "", "["]);
  assert.deepEqual(bad, [{ line: 4, pattern: "[" }]);
});

test("cleanTitle: plusieurs motifs appliqués en séquence + espaces normalisés", () => {
  const out = T.cleanTitle("[BE] WIP: Ajouter le login", ["\\[[^\\]]+\\]", "wip:?"]);
  assert.equal(out, "Ajouter le login");
});

test("buildVars: titleCleanups nettoie title/slug/branch, titleRaw conserve", () => {
  const data = { key: "DEMO-1", title: "[FRONT] Corriger l'échec", type: "Bug" };
  const opts = { ...OPTS, titleCleanups: ["\\[[^\\]]+\\]"] };
  assert.equal(T.renderTemplate("{title}", data, opts), "Corriger l'échec");
  assert.equal(T.renderTemplate("{titleRaw}", data, opts), "[FRONT] Corriger l'échec");
  assert.equal(T.renderTemplate("{slug}", data, opts), "corriger-l-echec");
  assert.equal(T.renderTemplate("{branch}", data, opts), "bugfix/DEMO-1-corriger-l-echec");
});

test("buildVars: stripTags retire les tags entre crochets", () => {
  const data = { key: "DEMO-1", title: "[FRONT] [BE] Ajouter le login", type: "Story" };
  assert.equal(
    T.renderTemplate("{title}", data, { ...OPTS, stripTags: true }),
    "Ajouter le login"
  );
  // Sans l'option, les tags restent.
  assert.equal(
    T.renderTemplate("{title}", data, OPTS),
    "[FRONT] [BE] Ajouter le login"
  );
});

test("buildVars: stripTags se combine aux motifs personnalisés", () => {
  const data = { key: "DEMO-1", title: "[FRONT] WIP: Ajouter le login", type: "Story" };
  const out = T.renderTemplate("{slug}", data, {
    ...OPTS,
    stripTags: true,
    titleCleanups: ["wip:?"],
  });
  assert.equal(out, "ajouter-le-login");
});

test("pickByType choisit selon une sous-chaîne du type, sinon default", () => {
  const map = { bug: "fix", chore: "chore", default: "feat" };
  assert.equal(T.pickByType("Bug", map), "fix");
  assert.equal(T.pickByType("Sub-bug task", map), "fix");
  assert.equal(T.pickByType("Story", map), "feat");
  assert.equal(T.pickByType("", map), "feat");
});

test("projectFromKey extrait le préfixe projet", () => {
  assert.equal(T.projectFromKey("DEMO-1234"), "DEMO");
  assert.equal(T.projectFromKey("AB12-9"), "AB12");
  assert.equal(T.projectFromKey("pas une clé"), "");
});

test("isoDate formate AAAA-MM-JJ avec zéros", () => {
  assert.equal(T.isoDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("renderTemplate remplace les variables de base", () => {
  assert.equal(T.renderTemplate("{key} {title}", SAMPLE, OPTS), "DEMO-1234 Corriger l'échec de connexion (été)");
  assert.equal(T.renderTemplate("{project}", SAMPLE, OPTS), "DEMO");
  assert.equal(T.renderTemplate("{date}", SAMPLE, OPTS), "2026-07-18");
});

test("renderTemplate: branche et commit dépendent du type", () => {
  assert.equal(
    T.renderTemplate("{branch}", SAMPLE, OPTS),
    "bugfix/DEMO-1234-corriger-l-echec-de-connexion-ete"
  );
  assert.equal(T.renderTemplate("{commitType}", SAMPLE, OPTS), "fix");
  const story = { ...SAMPLE, type: "Story" };
  assert.equal(T.renderTemplate("{branchPrefix}", story, OPTS), "feature/");
});

test("renderTemplate: titleLower et titleMd", () => {
  assert.equal(
    T.renderTemplate("{titleLower}", { title: "AbC DéF" }),
    "abc déf"
  );
  assert.equal(T.renderTemplate("{titleMd}", { title: "a*b" }), "a\\*b");
});

test("renderTemplate: troncature {slug:N} coupe sur un tiret", () => {
  const out = T.renderTemplate("{slug:20}", SAMPLE, OPTS);
  assert.ok(out.length <= 20, `longueur ${out.length}`);
  assert.ok(!out.endsWith("-"));
  assert.equal(out, "corriger-l-echec-de");
});

test("renderTemplate: troncature {title:N} retire l'espace final", () => {
  assert.equal(T.renderTemplate("{title:10}", { title: "Bonjour le monde" }), "Bonjour le");
  assert.equal(T.renderTemplate("{title:8}", { title: "Bonjour le monde" }), "Bonjour");
});

test("renderTemplate: variable inconnue laissée telle quelle", () => {
  assert.equal(T.renderTemplate("{inconnu}", SAMPLE, OPTS), "{inconnu}");
});

test("renderTemplate: parentKey vide par défaut, présent si fourni", () => {
  assert.equal(T.renderTemplate("{parentKey}", SAMPLE, OPTS), "");
  assert.equal(
    T.renderTemplate("{parentKey}", { ...SAMPLE, parentKey: "DEMO-1000" }, OPTS),
    "DEMO-1000"
  );
});

test("renderMultiple applique le gabarit ligne par ligne", () => {
  const tickets = [
    { key: "AB-1", title: "Un", url: "u1" },
    { key: "AB-2", title: "Deux", url: "u2" },
  ];
  assert.equal(
    T.renderMultiple("- [ ] [{key}]({url}) {title}", tickets),
    "- [ ] [AB-1](u1) Un\n- [ ] [AB-2](u2) Deux"
  );
});

test("looksLikeMarkdown détecte liens, listes, titres", () => {
  assert.equal(T.looksLikeMarkdown("[x](http://a)"), true);
  assert.equal(T.looksLikeMarkdown("- [ ] tâche"), true);
  assert.equal(T.looksLikeMarkdown("- item"), true);
  assert.equal(T.looksLikeMarkdown("## Titre"), true);
  assert.equal(T.looksLikeMarkdown("texte simple"), false);
});

test("markdownToHtml: lien → <a>", () => {
  assert.equal(
    T.markdownToHtml("[DEMO-1](https://x/browse/DEMO-1) Titre"),
    '<p><a href="https://x/browse/DEMO-1">DEMO-1</a> Titre</p>'
  );
});

test("markdownToHtml: checklist → <ul><li>", () => {
  const out = T.markdownToHtml("- [ ] [AB-1](u1) Un\n- [x] [AB-2](u2) Deux");
  assert.equal(
    out,
    '<ul>\n<li>☐ <a href="u1">AB-1</a> Un</li>\n<li>☑ <a href="u2">AB-2</a> Deux</li>\n</ul>'
  );
});

test("markdownToHtml: titre et paragraphe", () => {
  const out = T.markdownToHtml("## DEMO-1 Titre\n\nUn paragraphe");
  assert.equal(out, "<h2>DEMO-1 Titre</h2>\n<p>Un paragraphe</p>");
});

test("markdownToHtml: échappe le HTML dans le texte", () => {
  assert.equal(T.markdownToHtml("a <b> & c"), "<p>a &lt;b&gt; &amp; c</p>");
});
