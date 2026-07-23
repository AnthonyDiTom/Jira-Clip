// template-engine.js
// Logique *pure* (sans DOM) : transformations de texte + moteur de gabarits +
// conversion Markdown → HTML. Extraite d'extract-fn.js pour être testable en
// Node (voir test/) et réutilisable dans tous les contextes de l'extension.
//
// Chargé comme script classique dans la page / popup / options / worker : il
// s'expose sur `self.JiraTemplate`. En Node (tests), il s'exporte via
// `module.exports`.
(function (root, factory) {
  const api = factory();
  root.JiraTemplate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Un "key" Jira ressemble à DEMO-1234 : lettres/chiffres majuscules + "-" + nombre.
  const KEY_RE = /([A-Z][A-Z0-9]+-\d+)/;

  // Repli si les réglages ne sont pas fournis (contexte page brut).
  const FALLBACK_BRANCH_PREFIXES = { bug: "bugfix/", default: "feature/" };
  const FALLBACK_COMMIT_TYPES = { bug: "fix", default: "feat" };

  // Motif retirant les tags entre crochets ("[FRONT]", "[BE]"…). Utilisé par
  // l'option pratique `stripTags` (voir buildVars) et exposé pour réutilisation.
  const TAG_CLEANUP = "\\[[^\\]]+\\]";

  // Réduit les espaces/retours à la ligne multiples en un seul espace.
  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // Échappe les métacaractères d'une expression régulière.
  function escapeRegExp(s) {
    return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Retire "KEY", "[KEY]", "KEY -", "KEY:" en préfixe d'un titre.
  function stripKeyPrefix(text, key) {
    let t = normalizeWhitespace(text);
    if (key) {
      const re = new RegExp("^\\[?" + escapeRegExp(key) + "\\]?\\s*[-:–]?\\s*");
      t = t.replace(re, "").trim();
    }
    return t;
  }

  // Analyse une entrée de nettoyage du titre en corps + drapeaux de regex :
  //   - "/motif/flags" → { body: "motif", flags } (flags facultatifs) ;
  //   - "motif"        → { body: "motif", flags: "gi" } (casse ignorée).
  // Le drapeau "g" est toujours ajouté (on retire toutes les occurrences).
  // Renvoie null si l'entrée doit être ignorée (non-chaîne, vide, corps vide).
  function parseCleanup(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    let body = raw;
    let flags = "gi";
    const m = raw.match(/^\/(.*)\/([a-z]*)$/is);
    if (m) {
      body = m[1];
      flags = m[2] || "";
    }
    if (!body) return null; // corps vide → ignoré (éviterait d'insérer partout)
    if (!flags.includes("g")) flags += "g";
    return { body, flags };
  }

  // Vérifie une liste de motifs de nettoyage et renvoie ceux dont la regex ne
  // compile pas, sous forme [{ line, pattern }] (line = position 1-based dans
  // `cleanups`, pratique pour afficher un message à l'utilisateur). Les entrées
  // ignorées (vides) ne sont jamais signalées. Aucune erreur levée.
  function findInvalidCleanups(cleanups) {
    const out = [];
    if (!Array.isArray(cleanups)) return out;
    cleanups.forEach((raw, i) => {
      const p = parseCleanup(raw);
      if (!p) return; // entrée vide/ignorée → pas une erreur
      try {
        new RegExp(p.body, p.flags);
      } catch (_) {
        out.push({ line: i + 1, pattern: String(raw).trim() });
      }
    });
    return out;
  }

  // Retire du titre les portions correspondant à des motifs fournis par
  // l'utilisateur (bruit : tags "[FRONT]", préfixes d'équipe, numéros…), puis
  // normalise les espaces. Chaque entrée de `cleanups` est une chaîne analysée
  // par parseCleanup. Les motifs invalides ou vides sont ignorés
  // silencieusement (voir findInvalidCleanups pour les signaler). Sans motif,
  // le titre est renvoyé tel quel (aucun changement de comportement).
  function cleanTitle(title, cleanups) {
    const t = String(title || "");
    if (!Array.isArray(cleanups) || cleanups.length === 0) return t;
    let out = t;
    for (const raw of cleanups) {
      const p = parseCleanup(raw);
      if (!p) continue;
      let re;
      try {
        re = new RegExp(p.body, p.flags);
      } catch (_) {
        continue; // motif invalide → ignoré
      }
      // Remplacé par un espace pour ne pas coller les mots voisins.
      out = out.replace(re, " ");
    }
    return normalizeWhitespace(out);
  }

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
    return (s || "").replace(/([\\`*_[\]<>|])/g, "\\$1");
  }

  // Échappe le texte pour une insertion sûre dans du HTML.
  function escapeHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Tronque une chaîne à `max` caractères, puis retire un séparateur final
  // laissé par la coupe (slug : pas de "-" traînant ; texte : pas d'espace).
  function truncate(s, max, sep) {
    s = String(s || "");
    if (!Number.isFinite(max) || max <= 0 || s.length <= max) return s;
    const sepChar = sep || " ";
    return s.slice(0, max).replace(new RegExp(escapeRegExp(sepChar) + "+$"), "");
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

  // Projet déduit de la clé : "DEMO-1234" → "DEMO".
  function projectFromKey(key) {
    const m = String(key || "").match(/^([A-Z][A-Z0-9]+)-\d+/);
    return m ? m[1] : "";
  }

  // Date du jour au format ISO (AAAA-MM-JJ). `now` injectable pour les tests.
  function isoDate(now) {
    now = now || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // Construit la table des variables disponibles pour un ticket.
  function buildVars(data, opts) {
    opts = opts || {};
    const branchPrefix = pickByType(
      data.type,
      opts.branchPrefixes,
      FALLBACK_BRANCH_PREFIXES
    );
    const commitType = pickByType(data.type, opts.commitTypes, FALLBACK_COMMIT_TYPES);
    // Titre nettoyé des motifs de bruit (voir cleanTitle) : il alimente toutes
    // les variables de titre, y compris {slug}/{branch}. {titleRaw} garde
    // l'original. `stripTags` ajoute le retrait des tags entre crochets aux
    // motifs personnalisés.
    const rawTitle = data.title || "";
    const cleanups = [];
    if (opts.stripTags) cleanups.push(TAG_CLEANUP);
    if (Array.isArray(opts.titleCleanups)) cleanups.push(...opts.titleCleanups);
    const title = cleanTitle(rawTitle, cleanups);
    const slug = slugify(title);
    const branch = slug
      ? `${branchPrefix}${data.key}-${slug}`
      : `${branchPrefix}${data.key}`;

    return {
      key: data.key || "",
      title,
      titleRaw: rawTitle,
      titleMd: escapeMarkdown(title),
      titleLower: title.toLowerCase(),
      slug,
      url: data.url || "",
      type: data.type || "",
      status: data.status || "",
      assignee: data.assignee || "",
      priority: data.priority || "",
      project: data.project || projectFromKey(data.key),
      parentKey: data.parentKey || "",
      commitType,
      branchPrefix,
      branch,
      date: isoDate(opts.now),
    };
  }

  // Remplace les variables {…} d'un gabarit à partir des données du ticket.
  // Supporte la troncature `{name:N}` (garde au plus N caractères).
  // opts = { branchPrefixes, commitTypes, now } (facultatif).
  function renderTemplate(template, data, opts) {
    const vars = buildVars(data || {}, opts);
    return String(template || "").replace(
      /\{(\w+)(?::(\d+))?\}/g,
      (whole, name, len) => {
        if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
        let val = vars[name];
        if (len) {
          const sep = name === "slug" || name === "branch" ? "-" : " ";
          val = truncate(val, parseInt(len, 10), sep);
        }
        return val;
      }
    );
  }

  // Construit la sortie multi-tickets : un gabarit appliqué à chaque ticket,
  // les lignes jointes par un retour à la ligne.
  function renderMultiple(template, tickets, opts) {
    return (tickets || [])
      .map((t) => renderTemplate(template, t, opts))
      .join("\n");
  }

  // ---- Markdown → HTML (sous-ensemble utile) -------------------------------
  // Détecte si un texte contient de la syntaxe Markdown qu'on sait convertir :
  // lien en ligne [txt](url) ou item de liste/checklist en début de ligne.
  function looksLikeMarkdown(text) {
    if (!text) return false;
    if (/\[[^\]]+\]\([^)]+\)/.test(text)) return true; // lien
    if (/^\s*[-*] (\[[ xX]\] )?/m.test(text)) return true; // liste / checklist
    if (/^#{1,6}\s/m.test(text)) return true; // titre
    return false;
  }

  // Convertit une portion *en ligne* : liens [txt](url) → <a>, `code` → <code>.
  function inlineMd(text) {
    // On échappe d'abord tout le HTML, puis on réinjecte les balises produites.
    let out = escapeHtml(text);
    // Lien : [txt](url) — l'URL est déjà échappée par escapeHtml (guillemets).
    out = out.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (m, txt, url) => `<a href="${url}">${txt}</a>`
    );
    // Code en ligne `…`
    out = out.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    // Emphase **gras** puis *italique*
    out = out.replace(/\*\*([^*]+)\*\*/g, (m, c) => `<strong>${c}</strong>`);
    out = out.replace(/\*([^*]+)\*/g, (m, c) => `<em>${c}</em>`);
    return out;
  }

  // Conversion Markdown → HTML pour le presse-papier (liens cliquables dans
  // les éditeurs riches). Gère : titres #, listes/checklists, paragraphes.
  function markdownToHtml(md) {
    const lines = String(md || "").split("\n");
    const html = [];
    let listType = null; // "ul" en cours

    const closeList = () => {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
        continue;
      }

      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (item) {
        if (listType !== "ul") {
          closeList();
          listType = "ul";
          html.push("<ul>");
        }
        // Checklist "[ ]" / "[x]" → case à cocher visuelle.
        const check = item[1].match(/^\[([ xX])\]\s+(.*)$/);
        if (check) {
          const checked = check[1].toLowerCase() === "x";
          const box = checked ? "☑" : "☐";
          html.push(`<li>${box} ${inlineMd(check[2])}</li>`);
        } else {
          html.push(`<li>${inlineMd(item[1])}</li>`);
        }
        continue;
      }

      closeList();
      if (line.trim() === "") continue;
      html.push(`<p>${inlineMd(line)}</p>`);
    }
    closeList();
    return html.join("\n");
  }

  return {
    KEY_RE,
    FALLBACK_BRANCH_PREFIXES,
    FALLBACK_COMMIT_TYPES,
    TAG_CLEANUP,
    normalizeWhitespace,
    escapeRegExp,
    stripKeyPrefix,
    parseCleanup,
    findInvalidCleanups,
    cleanTitle,
    slugify,
    escapeMarkdown,
    escapeHtml,
    truncate,
    pickByType,
    projectFromKey,
    isoDate,
    buildVars,
    renderTemplate,
    renderMultiple,
    looksLikeMarkdown,
    markdownToHtml,
  };
});
