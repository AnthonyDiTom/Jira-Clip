// extract-fn.js
// Logique partagée d'extraction du ticket Jira + moteur de gabarits + copie.
// Ce fichier est injecté dans la page (isolated world) via chrome.scripting,
// et chargé aussi dans la popup. Il s'expose via window.__jiraTicketHelper.
(function () {
  if (window.__jiraTicketHelper) return;

  // Un "key" Jira ressemble à DEMO-1234 : lettres/chiffres majuscules + "-" + nombre.
  const KEY_RE = /([A-Z][A-Z0-9]+-\d+)/;
  const KEY_RE_G = /([A-Z][A-Z0-9]+-\d+)/g;

  // Repli si les réglages ne sont pas fournis (contexte page brut).
  const FALLBACK_BRANCH_PREFIXES = { bug: "bugfix/", default: "feature/" };
  const FALLBACK_COMMIT_TYPES = { bug: "fix", default: "feat" };

  // ---- Extraction du numéro de ticket -------------------------------------
  function findKey() {
    const href = location.href;

    // 1) URL classique /browse/KEY
    let m = href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
    if (m) return m[1];

    // 2) Paramètres de requête fréquents dans les vues modernes de Jira
    const params = new URLSearchParams(location.search);
    for (const p of ["selectedIssue", "issue", "issueKey"]) {
      const v = params.get(p);
      if (v) {
        const mm = v.match(KEY_RE);
        if (mm) return mm[1];
      }
    }

    // 3) Le titre de l'onglet contient souvent [KEY] ...
    m = document.title.match(KEY_RE);
    if (m) return m[1];

    // 4) Repli sur le DOM (fil d'Ariane / liens vers /browse/)
    const selectors = [
      '[data-testid*="current-issue"]',
      '[data-testid*="breadcrumb"] a[href*="/browse/"]',
      'a[href*="/browse/"]',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      const fromText = (el.textContent || "").match(KEY_RE);
      if (fromText) return fromText[1];
      const fromHref = (el.getAttribute("href") || "").match(KEY_RE);
      if (fromHref) return fromHref[1];
    }

    return null;
  }

  // ---- Extraction du titre -------------------------------------------------
  // Réduit les espaces/retours à la ligne multiples en un seul espace.
  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function stripKeyPrefix(text, key) {
    let t = normalizeWhitespace(text);
    if (key) {
      // Retire "KEY", "[KEY]", "KEY -", "KEY:" en préfixe
      const re = new RegExp("^\\[?" + key + "\\]?\\s*[-:–]?\\s*");
      t = t.replace(re, "").trim();
    }
    return t;
  }

  function findTitle(key) {
    // 1) Titre (summary) dans le DOM — sélecteurs Jira Cloud + repli générique
    const selectors = [
      '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
      '[data-testid*="summary.heading"]',
      '[data-testid*="summary"] h1',
      "h1",
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.textContent && el.textContent.trim()) {
        return stripKeyPrefix(el.textContent, key);
      }
    }

    // 2) Repli sur le titre de l'onglet : "[KEY] Titre - Jira"
    let t = normalizeWhitespace(document.title)
      .replace(/^\[?[A-Z][A-Z0-9]+-\d+\]?\s*[-:–]?\s*/, "")
      .replace(/\s*[-–|]\s*Jira.*$/i, "")
      .trim();
    return t || null;
  }

  // ---- Champs additionnels (best-effort, Jira Cloud) ----------------------
  // Renvoie le premier texte/alt non vide trouvé parmi une liste de sélecteurs.
  function firstFieldValue(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      const val =
        (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("alt"))) ||
        el.textContent ||
        "";
      const clean = normalizeWhitespace(val);
      if (clean) return clean;
    }
    return "";
  }

  function findType() {
    return firstFieldValue([
      '[data-testid*="issue-type-field"] img',
      '[data-testid*="issue-type-field"] span',
      '[data-testid*="issuetype"] img',
      '[data-testid*="change-issue-type"] img',
      '[data-testid*="issue.views.issue-base.foundation.change-issue-type"] img',
    ]);
  }

  function findStatus() {
    return firstFieldValue([
      '[data-testid*="status-field"] button span',
      '[data-testid*="status-field"] span',
      '[data-testid*="status.status-field"] span',
      '[data-testid*="issue.fields.status"] span',
    ]);
  }

  function findAssignee() {
    return firstFieldValue([
      '[data-testid*="assignee"] [data-testid*="profileCardTrigger"]',
      '[data-testid*="assignee"] a',
      '[data-testid*="assignee"] span',
    ]);
  }

  function findPriority() {
    return firstFieldValue([
      '[data-testid*="priority-field"] img',
      '[data-testid*="priority-field"] span',
      '[data-testid*="priority"] img',
    ]);
  }

  function extract() {
    const key = findKey();
    if (!key) return { ok: false, error: "Aucun ticket Jira détecté sur cette page." };
    const title = findTitle(key) || "";
    const url = location.origin + "/browse/" + key;
    return {
      ok: true,
      key,
      title,
      url,
      type: findType(),
      status: findStatus(),
      assignee: findAssignee(),
      priority: findPriority(),
    };
  }

  // ---- Extraction multi-tickets (vues board / backlog / liste) ------------
  function extractMultiple() {
    const found = new Map(); // key -> { key, title, url }
    const origin = location.origin;

    // 1) Cartes de board / lignes de backlog (Jira Cloud)
    const cardSelectors = [
      '[data-testid*="platform-board-kit.ui.card"]',
      '[data-testid*="software-backlog.card"]',
      '[data-testid*="issue-line-card"]',
      '[data-testid*="list-row"]',
      "tr[data-issue-key]",
    ];
    for (const sel of cardSelectors) {
      for (const card of document.querySelectorAll(sel)) {
        const text = card.textContent || "";
        const km = text.match(KEY_RE);
        const dataKey = card.getAttribute && card.getAttribute("data-issue-key");
        const key = dataKey && KEY_RE.test(dataKey) ? dataKey : km && km[1];
        if (!key || found.has(key)) continue;
        const title = stripKeyPrefix(text, key);
        found.set(key, { key, title, url: origin + "/browse/" + key });
      }
    }

    // 2) Repli : tous les liens /browse/KEY de la page
    if (found.size === 0) {
      for (const a of document.querySelectorAll('a[href*="/browse/"]')) {
        const href = a.getAttribute("href") || "";
        const km = href.match(KEY_RE);
        if (!km || found.has(km[1])) continue;
        const key = km[1];
        const title = stripKeyPrefix(a.textContent || "", key);
        found.set(key, { key, title, url: origin + "/browse/" + key });
      }
    }

    return Array.from(found.values());
  }

  // ---- Transformations -----------------------------------------------------
  // Transforme un texte en segment sûr pour un nom de branche git :
  // accents retirés, minuscules, tout ce qui n'est pas [a-z0-9] devient "-".
  function slugify(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // diacritiques
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Échappe les caractères Markdown ayant un sens *en ligne* (après le lien).
  function escapeMarkdown(s) {
    return (s || "").replace(/([\\`*_\[\]<>|])/g, "\\$1");
  }

  // Choisit une valeur dans une map { sousChaîne: valeur, default: … } selon
  // le type d'issue (recherche insensible à la casse).
  function pickByType(type, map, fallback) {
    const m = map || fallback;
    const t = (type || "").toLowerCase();
    for (const k of Object.keys(m)) {
      if (k === "default") continue;
      if (t && t.includes(k.toLowerCase())) return m[k];
    }
    return m.default != null ? m.default : "";
  }

  // ---- Moteur de gabarits --------------------------------------------------
  // Remplace les variables {…} d'un gabarit à partir des données du ticket.
  // opts = { branchPrefixes, commitTypes } (facultatif).
  function renderTemplate(template, data, opts) {
    opts = opts || {};
    const branchPrefix = pickByType(
      data.type,
      opts.branchPrefixes,
      FALLBACK_BRANCH_PREFIXES
    );
    const commitType = pickByType(data.type, opts.commitTypes, FALLBACK_COMMIT_TYPES);
    const slug = slugify(data.title);
    const branch = slug ? `${branchPrefix}${data.key}-${slug}` : `${branchPrefix}${data.key}`;

    const vars = {
      key: data.key || "",
      title: data.title || "",
      titleMd: escapeMarkdown(data.title || ""),
      slug,
      url: data.url || "",
      type: data.type || "",
      status: data.status || "",
      assignee: data.assignee || "",
      priority: data.priority || "",
      commitType,
      branchPrefix,
      branch,
    };

    return String(template || "").replace(/\{(\w+)\}/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole
    );
  }

  // Construit la sortie multi-tickets : un gabarit appliqué à chaque ticket,
  // les lignes jointes par un retour à la ligne.
  function renderMultiple(template, tickets, opts) {
    return (tickets || [])
      .map((t) => renderTemplate(template, t, opts))
      .join("\n");
  }

  // ---- Copie presse-papier -------------------------------------------------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Repli si l'API Clipboard est indisponible (page non focalisée, etc.)
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // ---- Petit toast dans la page (raccourci / menu contextuel) --------------
  function toast(message, isError) {
    const id = "__jira-ticket-toast";
    document.getElementById(id)?.remove();
    const el = document.createElement("div");
    el.id = id;
    el.textContent = message;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      maxWidth: "360px",
      padding: "10px 14px",
      borderRadius: "8px",
      font: "13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#fff",
      background: isError ? "#c9372c" : "#1868db",
      boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      transition: "opacity .3s",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  // Extraction + rendu + copie + toast, en un appel (raccourci / menu contextuel).
  async function extractAndCopy(template, opts) {
    const data = extract();
    if (!data.ok) {
      toast(data.error, true);
      return data;
    }
    const text = renderTemplate(template, data, opts);
    const copied = await copyText(text);
    toast(copied ? "Copié : " + text : "Échec de la copie", !copied);
    return { ok: copied, text, key: data.key, title: data.title, url: data.url };
  }

  window.__jiraTicketHelper = {
    extract,
    extractMultiple,
    renderTemplate,
    renderMultiple,
    slugify,
    copyText,
    extractAndCopy,
  };
})();
