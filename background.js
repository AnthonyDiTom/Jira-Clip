// background.js — service worker (MV3)
// Orchestre le menu contextuel (construit à partir des formats enregistrés),
// les raccourcis clavier et l'historique. L'extraction + la copie se font
// dans la page via chrome.scripting.
importScripts("template-engine.js", "extract-core.js", "i18n.js", "settings.js");

const ROOT_ID = "jira-root";
// Raccourci clavier → id de format.
const COMMAND_TO_FORMAT = {
  "copy-ticket-full": "full",
  "copy-ticket-branch": "branch",
  "copy-ticket-markdown": "markdown",
};

// ---- Menu contextuel -----------------------------------------------------
async function buildContextMenu() {
  const settings = await self.JiraSettings.getSettings();
  self.JiraI18n.setLang(settings.language || "auto");
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({
    id: ROOT_ID,
    title: self.JiraI18n.t("menuRoot"),
    contexts: ["page", "selection", "link"],
  });
  for (const f of settings.formats) {
    chrome.contextMenus.create({
      id: "fmt:" + f.id,
      parentId: ROOT_ID,
      title: self.JiraI18n.t("menuCopy", { label: f.label }),
      contexts: ["page", "selection", "link"],
    });
  }
}

// ---- Content scripts dynamiques (instances Jira personnalisées) ----------
// Le content script par défaut ne couvre que *.atlassian.net. Pour les
// instances self-hosted, l'utilisateur ajoute une origine dans les options
// (avec permission hôte) ; on enregistre alors le script à la volée.
const CUSTOM_PREFIX = "custom-";
const CONTENT_JS = [
  "settings.js",
  "template-engine.js",
  "extract-core.js",
  "i18n.js",
  "extract-fn.js",
  "page-buttons.js",
];

function idForOrigin(origin) {
  // Identifiant stable et alphanumérique dérivé du motif d'origine.
  return CUSTOM_PREFIX + origin.replace(/[^a-zA-Z0-9]/g, "");
}

// Aligne les content scripts enregistrés sur les origines autorisées.
async function reconcileContentScripts() {
  try {
    const settings = await self.JiraSettings.getSettings();
    const origins = (settings.customOrigins || []).filter(
      (o) => typeof o === "string" && o
    );

    // Origines réellement autorisées (permission hôte accordée).
    const granted = [];
    for (const o of origins) {
      try {
        if (await chrome.permissions.contains({ origins: [o] })) granted.push(o);
      } catch (_) {
        /* motif invalide : ignoré */
      }
    }

    const registered = await chrome.scripting.getRegisteredContentScripts();
    const existingIds = new Set(registered.map((s) => s.id));
    const desiredIds = new Set(granted.map(idForOrigin));

    const toRegister = granted
      .filter((o) => !existingIds.has(idForOrigin(o)))
      .map((o) => ({
        id: idForOrigin(o),
        matches: [o],
        js: CONTENT_JS,
        runAt: "document_idle",
      }));
    if (toRegister.length) {
      await chrome.scripting.registerContentScripts(toRegister);
    }

    const toRemove = registered
      .filter((s) => s.id.startsWith(CUSTOM_PREFIX) && !desiredIds.has(s.id))
      .map((s) => s.id);
    if (toRemove.length) {
      await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    }
  } catch (e) {
    console.error("[Jira Ticket Copier] reconcileContentScripts :", e);
  }
}

function onInit() {
  buildContextMenu();
  reconcileContentScripts();
}

chrome.runtime.onInstalled.addListener(onInit);
chrome.runtime.onStartup.addListener(onInit);

// Réagit aux changements de réglages : menu + origines personnalisées.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) {
    buildContextMenu();
    reconcileContentScripts();
  }
});

// Une permission hôte accordée/révoquée depuis les options doit (dé)clencher
// l'enregistrement correspondant.
chrome.permissions.onAdded.addListener(reconcileContentScripts);
chrome.permissions.onRemoved.addListener(reconcileContentScripts);

// ---- Copie ---------------------------------------------------------------
// Injecte la logique partagée, applique le gabarit du format dans l'onglet,
// puis enregistre le ticket dans l'historique.
async function runCopy(tabId, formatId) {
  if (tabId == null) return;
  const settings = await self.JiraSettings.getSettings();
  const format = settings.formats.find((f) => f.id === formatId);
  if (!format) return;
  const opts = {
    branchPrefixes: settings.branchPrefixes,
    commitTypes: settings.commitTypes,
    titleCleanups: settings.titleCleanups,
    stripTags: settings.stripTags,
  };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["template-engine.js", "extract-core.js", "i18n.js", "extract-fn.js"],
    });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (tpl, o, lang) => window.__jiraTicketHelper.extractAndCopy(tpl, o, lang),
      args: [format.template, opts, settings.language || "auto"],
    });
    const out = res && res.result;
    if (out && out.ok && out.key) {
      await self.JiraSettings.addHistory(
        { key: out.key, title: out.title, url: out.url },
        settings.historyLimit
      );
    }
  } catch (e) {
    console.error("[Jira Ticket Copier] Injection impossible :", e);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId || "");
  if (id.startsWith("fmt:")) {
    runCopy(tab?.id, id.slice(4));
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-pane") {
    // L'ouverture/fermeture du panneau vit dans le content script : on lui
    // relaie l'intention. Échoue silencieusement hors d'un onglet Jira.
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: "toggle-pane" }).catch(() => {});
    }
    return;
  }
  const formatId = COMMAND_TO_FORMAT[command];
  if (formatId) runCopy(tab?.id, formatId);
});

// ---- Messages depuis les content scripts ---------------------------------
// Le panneau latéral (page-buttons.js) ne peut pas appeler openOptionsPage()
// directement : il passe par le service worker.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  // La page d'options n'a pas la session Jira : elle nous délègue la recherche
  // de personnes, qu'on relaie à un onglet Jira ouvert (content script).
  if (msg && msg.type === "search-users") {
    relaySearchUsers(msg.query).then(sendResponse);
    return true; // réponse asynchrone
  }
});

// Fait exécuter la recherche de personnes par un onglet Jira ouvert (son
// content script a la session). On diffuse à tous les onglets sans filtrer par
// URL (ce qui éviterait d'exiger la permission « tabs ») : seuls les content
// scripts Jira répondent, on garde la première réponse exploitable.
// Renvoie { ok, results, error? }. Best-effort.
async function relaySearchUsers(query) {
  try {
    const tabs = await chrome.tabs.query({});
    const ask = (tabId) =>
      chrome.tabs
        .sendMessage(tabId, { type: "search-users", query })
        .catch(() => null); // onglet sans content script (pas de récepteur)
    const responses = await Promise.all(
      tabs.filter((t) => t.id != null).map((t) => ask(t.id))
    );
    const hit = responses.find((r) => r && r.ok && Array.isArray(r.results));
    if (hit) return hit;
    return { ok: false, error: "no-jira-tab", results: [] };
  } catch (e) {
    return { ok: false, error: String(e), results: [] };
  }
}
