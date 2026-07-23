// extract-core.js
// Logique *pure* d'extraction d'un ticket Jira à partir d'un document + d'une
// « location ». Extraite d'extract-fn.js pour être testable hors navigateur
// (voir test/extract-core.test.js, DOM simulé via jsdom) et réutilisable.
//
// Aucune fonction ici ne touche aux globales `document`/`location` : tout passe
// par les paramètres `doc` (un Document) et `loc` (objet { href, search,
// origin }, p. ex. `window.location`). Aucune ne lève d'exception : en cas de
// DOM inattendu, on renvoie un repli propre (valeurs vides / `ok: false`).
//
// Chargé comme script classique dans la page / popup / options / worker : il
// s'expose sur `self.JiraExtract`. En Node (tests), il s'exporte via
// `module.exports` et récupère JiraTemplate par `require`.
(function (root, factory) {
  const T =
    typeof module !== "undefined" && module.exports
      ? require("./template-engine.js")
      : root.JiraTemplate;
  const api = factory(T);
  root.JiraExtract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const KEY_RE = T.KEY_RE;

  // Forme d'un résultat d'extraction vide (mais valide) pour une clé donnée.
  // Sert de repli quand les sélecteurs ne matchent pas : plutôt qu'une
  // exception, on renvoie des champs vides et le projet déduit de la clé.
  function emptyResult(key, url) {
    return {
      ok: true,
      key,
      title: "",
      url: url || "",
      type: "",
      status: "",
      assignee: "",
      priority: "",
      project: T.projectFromKey(key),
      parentKey: "",
    };
  }

  // querySelector défensif : ne lève jamais (sélecteur invalide, doc absent…).
  function safeQuery(doc, selector) {
    try {
      return doc && doc.querySelector ? doc.querySelector(selector) : null;
    } catch (_) {
      return null;
    }
  }

  function safeQueryAll(doc, selector) {
    try {
      return doc && doc.querySelectorAll ? [...doc.querySelectorAll(selector)] : [];
    } catch (_) {
      return [];
    }
  }

  // ---- Extraction du numéro de ticket -------------------------------------
  function findKey(doc, loc) {
    const href = (loc && loc.href) || "";

    // 1) URL classique /browse/KEY
    let m = href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
    if (m) return m[1];

    // 2) Paramètres de requête fréquents dans les vues modernes de Jira
    const params = new URLSearchParams((loc && loc.search) || "");
    for (const p of ["selectedIssue", "issue", "issueKey"]) {
      const v = params.get(p);
      if (v) {
        const mm = v.match(KEY_RE);
        if (mm) return mm[1];
      }
    }

    // 3) Le titre de l'onglet contient souvent [KEY] ...
    m = (doc && doc.title ? doc.title : "").match(KEY_RE);
    if (m) return m[1];

    // 4) Repli sur le DOM (fil d'Ariane / liens vers /browse/)
    const selectors = [
      '[data-testid*="current-issue"]',
      '[data-testid*="breadcrumb"] a[href*="/browse/"]',
      'a[href*="/browse/"]',
    ];
    for (const s of selectors) {
      const el = safeQuery(doc, s);
      if (!el) continue;
      const fromText = (el.textContent || "").match(KEY_RE);
      if (fromText) return fromText[1];
      const fromHref = (el.getAttribute("href") || "").match(KEY_RE);
      if (fromHref) return fromHref[1];
    }

    return null;
  }

  // ---- Extraction du titre -------------------------------------------------
  function findTitle(doc, key) {
    // 1) Titre (summary) dans le DOM — sélecteurs Jira Cloud + repli générique
    const selectors = [
      '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
      '[data-testid*="summary.heading"]',
      '[data-testid*="summary"] h1',
      "h1",
    ];
    for (const s of selectors) {
      const el = safeQuery(doc, s);
      if (el && el.textContent && el.textContent.trim()) {
        return T.stripKeyPrefix(el.textContent, key);
      }
    }

    // 2) Repli sur le titre de l'onglet : "[KEY] Titre - Jira"
    const t = T.normalizeWhitespace(doc && doc.title ? doc.title : "")
      .replace(/^\[?[A-Z][A-Z0-9]+-\d+\]?\s*[-:–]?\s*/, "")
      .replace(/\s*[-–|]\s*Jira.*$/i, "")
      .trim();
    return t || null;
  }

  // ---- Champs additionnels (best-effort, Jira Cloud) ----------------------
  function firstFieldValue(doc, selectors) {
    for (const s of selectors) {
      const el = safeQuery(doc, s);
      if (!el) continue;
      const val =
        (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("alt"))) ||
        el.textContent ||
        "";
      const clean = T.normalizeWhitespace(val);
      if (clean) return clean;
    }
    return "";
  }

  function findType(doc) {
    return firstFieldValue(doc, [
      '[data-testid*="issue-type-field"] img',
      '[data-testid*="issue-type-field"] span',
      '[data-testid*="issuetype"] img',
      '[data-testid*="change-issue-type"] img',
      '[data-testid*="issue.views.issue-base.foundation.change-issue-type"] img',
    ]);
  }

  function findStatus(doc) {
    // On vise *uniquement* le statut du ticket principal. Des sélecteurs trop
    // larges (p. ex. [data-testid*="status-field"] ou *="issue.fields.status")
    // capturent aussi les « lozenges » de statut des issues liées / enfants /
    // cartes de liste présentes sur la page (status-lozenge, issue-line-card…),
    // dont la première en ordre DOM peut être n'importe quel statut (« New »).
    return firstFieldValue(doc, [
      // Bouton de statut du ticket principal (vue moderne Jira Cloud).
      '[data-testid*="status-view.status-button.status-button"]',
      // Conteneur « fondation » du statut de l'issue principale.
      '[data-testid*="foundation.status"] button span',
      '[data-testid*="foundation.status.status-field-wrapper"] span',
      // Variante : champ statut principal (exclut les lozenges status-lozenge).
      '[data-testid*="issue.fields.status.common.ui.status-field"] span',
    ]);
  }

  function findAssignee(doc) {
    // La valeur (nom de la personne) vit dans le conteneur du champ user,
    // distinct du libellé « Assignee » (heading). On cible d'abord ce
    // conteneur : un sélecteur trop large capturerait le libellé, qui
    // précède la valeur dans le DOM.
    const containers = [
      '[data-testid="issue.views.field.user.assignee"]',
      '[data-testid*="field.user.assignee"]',
      '[data-testid*="assignee"]:not([data-testid*="heading"])',
    ];
    for (const s of containers) {
      const rootEl = safeQuery(doc, s);
      if (!rootEl) continue;
      // Spans/liens « feuilles » (sans enfant span/a) : évite le texte
      // dupliqué des conteneurs imbriqués (nom visible + copie masquée a11y).
      const leaves = [...rootEl.querySelectorAll("span, a")].filter(
        (e) => !e.querySelector("span, a")
      );
      for (const leaf of leaves) {
        const clean = T.normalizeWhitespace(leaf.textContent || "");
        if (clean) return clean;
      }
    }
    return "";
  }

  function findPriority(doc) {
    // Comme pour l'assigné, un sélecteur trop large capturerait le libellé
    // « Priority » (heading) au lieu de la valeur. On cible le conteneur de
    // valeur en excluant le heading, puis on lit l'icône (alt) ou le texte.
    const containers = [
      '[data-testid*="priority-readview"]',
      '[data-testid*="priority-field"]:not([data-testid*="heading"])',
      '[data-testid*="priority"]:not([data-testid*="heading"])',
    ];
    for (const s of containers) {
      const rootEl = safeQuery(doc, s);
      if (!rootEl) continue;
      // Priorité affichée en icône : le libellé est dans l'attribut alt.
      const img = rootEl.tagName === "IMG" ? rootEl : rootEl.querySelector("img");
      if (img) {
        const alt = T.normalizeWhitespace(img.getAttribute("alt") || "");
        if (alt) return alt;
      }
      // Priorité affichée en texte : span « feuille » (évite le libellé).
      const leaves = [...rootEl.querySelectorAll("span, a")].filter(
        (e) => !e.querySelector("span, a")
      );
      for (const leaf of leaves) {
        const clean = T.normalizeWhitespace(leaf.textContent || "");
        if (clean) return clean;
      }
    }
    return "";
  }

  // ---- Extraction complète -------------------------------------------------
  // extract : détecte la clé sur la page puis lit les champs. Renvoie
  //   { ok: false, error } si aucune clé n'est détectable,
  //   { ok: true, key, title, … } (champs vides à défaut) sinon.
  // Ne lève jamais : toute erreur inattendue retombe sur le repli.
  function extract(doc, loc) {
    try {
      const key = findKey(doc, loc);
      if (!key) return { ok: false, error: "Aucun ticket Jira détecté sur cette page." };
      return extractFor(doc, loc, key);
    } catch (_) {
      return { ok: false, error: "Aucun ticket Jira détecté sur cette page." };
    }
  }

  // Extraction pour une clé donnée (saisie manuelle ou détectée). Le titre et
  // les champs ne sont lus dans le DOM que si la clé correspond à celle de la
  // page courante (sinon on ne connaît que la clé et l'URL déduite).
  function extractFor(doc, loc, key) {
    const origin = (loc && loc.origin) || "";
    const url = origin + "/browse/" + key;
    try {
      const pageKey = findKey(doc, loc);
      const onPage = key === pageKey;
      return {
        ok: true,
        key,
        title: onPage ? findTitle(doc, key) || "" : "",
        url,
        type: onPage ? findType(doc) : "",
        status: onPage ? findStatus(doc) : "",
        assignee: onPage ? findAssignee(doc) : "",
        priority: onPage ? findPriority(doc) : "",
        project: T.projectFromKey(key),
        parentKey: "",
      };
    } catch (_) {
      return emptyResult(key, url);
    }
  }

  // ---- Extraction multi-tickets (vues board / backlog / liste) ------------
  function extractMultiple(doc, loc) {
    const found = new Map(); // key -> { key, title, url }
    const origin = (loc && loc.origin) || "";
    try {
      const cardSelectors = [
        '[data-testid*="platform-board-kit.ui.card"]',
        '[data-testid*="software-backlog.card"]',
        '[data-testid*="issue-line-card"]',
        '[data-testid*="list-row"]',
        "tr[data-issue-key]",
      ];
      for (const sel of cardSelectors) {
        for (const card of safeQueryAll(doc, sel)) {
          const text = card.textContent || "";
          const km = text.match(KEY_RE);
          const dataKey = card.getAttribute && card.getAttribute("data-issue-key");
          const key = dataKey && KEY_RE.test(dataKey) ? dataKey : km && km[1];
          if (!key || found.has(key)) continue;
          const title = T.stripKeyPrefix(text, key);
          found.set(key, { key, title, url: origin + "/browse/" + key });
        }
      }

      // Repli : tous les liens /browse/KEY de la page
      if (found.size === 0) {
        for (const a of safeQueryAll(doc, 'a[href*="/browse/"]')) {
          const href = a.getAttribute("href") || "";
          const km = href.match(KEY_RE);
          if (!km || found.has(km[1])) continue;
          const key = km[1];
          const title = T.stripKeyPrefix(a.textContent || "", key);
          found.set(key, { key, title, url: origin + "/browse/" + key });
        }
      }
    } catch (_) {
      /* DOM inattendu : on renvoie ce qui a pu être collecté */
    }

    return Array.from(found.values());
  }

  return {
    KEY_RE,
    emptyResult,
    findKey,
    findTitle,
    firstFieldValue,
    findType,
    findStatus,
    findAssignee,
    findPriority,
    extract,
    extractFor,
    extractMultiple,
  };
});
