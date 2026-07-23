// settings.js — réglages partagés + accès au stockage.
// Chargé dans la popup, la page d'options et le service worker (via importScripts).
// S'expose via `self.JiraSettings` (fonctionne en contexte document ET worker).
(function (root) {
  "use strict";

  // ---- Formats par défaut --------------------------------------------------
  // Chaque format possède : id, label, template (avec variables {…}), builtin.
  // Variables disponibles (voir extract-fn.js → renderTemplate) :
  //   {key} {title} {titleRaw} {titleMd} {slug} {url}
  //   {type} {status} {assignee} {priority}
  //   {commitType} {branchPrefix} {branch} {date}
  const DEFAULT_FORMATS = [
    { id: "full",     label: "Numéro + titre",       template: "{key} {title}",                 builtin: true },
    { id: "branch",   label: "Nom de branche git",   template: "{branch}",                      builtin: true },
    { id: "gitcmd",   label: "Commande git switch",  template: "git switch -c {branch}",        builtin: true },
    { id: "commit",   label: "Message de commit",    template: "{commitType}({key}): {title}",  builtin: true },
    { id: "markdown", label: "Lien Markdown",        template: "[{key}]({url}) {titleMd}",      builtin: true },
    { id: "key",      label: "Numéro seul",          template: "{key}",                         builtin: true },
    {
      id: "pr",
      label: "Description de PR",
      template:
        "## {key} {title}\n\n" +
        "**Ticket :** {url}\n\n" +
        "### Contexte\n\n\n" +
        "### Changements\n\n\n" +
        "### Tests\n\n",
      builtin: true,
    },
  ];

  // Gabarit pour la copie multi-tickets (vues board / backlog).
  const DEFAULT_MULTI_TEMPLATE = "- [ ] [{key}]({url}) {title}";

  // Correspondances type d'issue → préfixe de branche / type de commit.
  // La clé est une sous-chaîne recherchée (insensible à la casse) dans le type
  // d'issue Jira ; "default" sert de repli.
  const DEFAULT_BRANCH_PREFIXES = {
    bug: "bugfix/",
    bogue: "bugfix/",
    defect: "bugfix/",
    défaut: "bugfix/",
    hotfix: "hotfix/",
    incident: "hotfix/",
    epic: "epic/",
    spike: "spike/",
    default: "feature/",
  };

  const DEFAULT_COMMIT_TYPES = {
    bug: "fix",
    bogue: "fix",
    defect: "fix",
    défaut: "fix",
    hotfix: "fix",
    chore: "chore",
    task: "chore",
    tâche: "chore",
    doc: "docs",
    epic: "feat",
    default: "feat",
  };

  const DEFAULT_SETTINGS = {
    formats: DEFAULT_FORMATS,
    multiTemplate: DEFAULT_MULTI_TEMPLATE,
    branchPrefixes: DEFAULT_BRANCH_PREFIXES,
    commitTypes: DEFAULT_COMMIT_TYPES,
    // Retire automatiquement les tags entre crochets ("[FRONT]"…) du titre.
    // Raccourci pratique équivalent au motif TAG_CLEANUP, combiné aux motifs
    // personnalisés ci-dessous.
    stripTags: false,
    // Motifs (regex) retirés du titre avant génération des formats (slug,
    // branche, commit…). Chaque entrée : "/motif/flags" ou "motif" (casse
    // ignorée). Vide par défaut → titre inchangé. Voir template-engine.cleanTitle.
    titleCleanups: [],
    historyLimit: 8,
    // Langue de l'interface : "auto" (suit le navigateur), "fr" ou "en".
    language: "auto",
    // Instances Jira supplémentaires (self-hosted / domaines personnalisés) où
    // injecter le bouton de page. Chaque entrée est un motif de correspondance
    // (ex. "https://jira.exemple.com/*"). Nécessite une permission hôte.
    customOrigins: [],
    // Personnes proposées pour l'auto-assignation (max 5). Chaque entrée :
    // { accountId, displayName, avatarUrl }. Un bouton est créé par personne,
    // dans le panneau latéral et dans la barre d'actions Jira.
    assignees: [],
  };

  // Nombre maximum de personnes configurables pour l'auto-assignation.
  const MAX_ASSIGNEES = 5;

  const SETTINGS_KEY = "settings";
  const HISTORY_KEY = "history";
  const LAST_FORMAT_KEY = "lastFormatId";

  // Petit deep-clone sans dépendance.
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---- Réglages (chrome.storage.sync) --------------------------------------
  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(SETTINGS_KEY, (res) => {
        const stored = (res && res[SETTINGS_KEY]) || {};
        // Fusion superficielle avec les défauts : les tableaux/maps stockés
        // remplacent entièrement ceux par défaut ; le reste est complété.
        const merged = Object.assign(clone(DEFAULT_SETTINGS), stored);
        if (!Array.isArray(merged.formats) || merged.formats.length === 0) {
          merged.formats = clone(DEFAULT_FORMATS);
        }
        // Motifs de nettoyage du titre : uniquement des chaînes non vides.
        merged.titleCleanups = Array.isArray(merged.titleCleanups)
          ? merged.titleCleanups.filter((p) => typeof p === "string" && p.trim())
          : [];
        merged.stripTags = merged.stripTags === true;
        if (!Array.isArray(merged.assignees)) {
          merged.assignees = [];
        } else {
          // Ne garde que les entrées saines, tronquées au maximum autorisé.
          merged.assignees = merged.assignees
            .filter((a) => a && a.accountId && a.displayName)
            .slice(0, MAX_ASSIGNEES);
        }
        resolve(merged);
      });
    });
  }

  function saveSettings(settings) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [SETTINGS_KEY]: settings }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function resetSettings() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.remove(SETTINGS_KEY, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ---- Historique (chrome.storage.local) -----------------------------------
  function getHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(HISTORY_KEY, (res) => {
        resolve((res && res[HISTORY_KEY]) || []);
      });
    });
  }

  async function addHistory(entry, limit) {
    if (!entry || !entry.key) return;
    const max = Number.isFinite(limit) ? limit : DEFAULT_SETTINGS.historyLimit;
    const list = await getHistory();
    // Dédoublonnage par clé : la plus récente remonte en tête.
    const filtered = list.filter((e) => e.key !== entry.key);
    filtered.unshift({
      key: entry.key,
      title: entry.title || "",
      url: entry.url || "",
      ts: Date.now(),
    });
    const trimmed = filtered.slice(0, Math.max(0, max));
    return new Promise((resolve) => {
      chrome.storage.local.set({ [HISTORY_KEY]: trimmed }, resolve);
    });
  }

  function clearHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(HISTORY_KEY, resolve);
    });
  }

  // ---- Dernier format utilisé (chrome.storage.local) -----------------------
  function getLastFormatId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(LAST_FORMAT_KEY, (res) => {
        resolve((res && res[LAST_FORMAT_KEY]) || null);
      });
    });
  }

  function setLastFormatId(id) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [LAST_FORMAT_KEY]: id || null }, resolve);
    });
  }

  root.JiraSettings = {
    DEFAULT_SETTINGS,
    DEFAULT_FORMATS,
    DEFAULT_MULTI_TEMPLATE,
    MAX_ASSIGNEES,
    getSettings,
    saveSettings,
    resetSettings,
    getHistory,
    addHistory,
    clearHistory,
    getLastFormatId,
    setLastFormatId,
  };
})(self);
