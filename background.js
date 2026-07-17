// background.js — service worker (MV3)
// Orchestre le menu contextuel (construit à partir des formats enregistrés),
// les raccourcis clavier et l'historique. L'extraction + la copie se font
// dans la page via chrome.scripting.
importScripts("settings.js");

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
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({
    id: ROOT_ID,
    title: "Ticket Jira",
    contexts: ["page", "selection", "link"],
  });
  for (const f of settings.formats) {
    chrome.contextMenus.create({
      id: "fmt:" + f.id,
      parentId: ROOT_ID,
      title: "Copier : " + f.label,
      contexts: ["page", "selection", "link"],
    });
  }
}

chrome.runtime.onInstalled.addListener(buildContextMenu);
chrome.runtime.onStartup.addListener(buildContextMenu);

// Reconstruit le menu quand les formats changent dans les options.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) buildContextMenu();
});

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
  };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["extract-fn.js"],
    });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (tpl, o) => window.__jiraTicketHelper.extractAndCopy(tpl, o),
      args: [format.template, opts],
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
  const formatId = COMMAND_TO_FORMAT[command];
  if (formatId) runCopy(tab?.id, formatId);
});

// ---- Messages depuis les content scripts ---------------------------------
// Le panneau latéral (page-buttons.js) ne peut pas appeler openOptionsPage()
// directement : il passe par le service worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});
