// popup.js — s'exécute quand on clique sur l'icône de l'extension.
// Extrait le ticket dans l'onglet actif puis propose les boutons de copie,
// l'historique et, sur les vues liste/board, la copie multi-tickets.

const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const multiEl = document.getElementById("multi");
const historyEl = document.getElementById("history");

let SETTINGS = null;
let OPTS = null;

// Icône par format (repli sur 📋 pour les formats personnalisés).
const FORMAT_ICONS = {
  full: "🎫",
  branch: "🌿",
  gitcmd: "⎇",
  commit: "✎",
  markdown: "🔗",
  key: "#",
  pr: "⇄",
};
const iconFor = (id) => FORMAT_ICONS[id] || "📋";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Exécute une fonction du helper dans la page de l'onglet actif.
async function runInPage(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["extract-fn.js"] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

function setStatus(ok, text) {
  statusEl.className = ok ? "" : "error";
  statusEl.textContent = text;
}

async function copyAndFlash(text, btn, labelEl, closeAfter) {
  const ok = await window.__jiraTicketHelper.copyText(text);
  setStatus(ok, ok ? "Copié : " + text : "Échec de la copie");
  if (ok && btn) {
    btn.classList.add("copied");
    if (labelEl) labelEl.textContent = "✓ Copié";
  }
  return ok;
}

function renderError(message) {
  contentEl.innerHTML = `<div class="title error"></div>`;
  contentEl.querySelector(".title").textContent =
    message || "Aucun ticket Jira détecté sur cette page.";
}

function render(data) {
  contentEl.innerHTML = "";

  // En-tête : clé + titre + puces, regroupés dans une carte.
  const head = document.createElement("div");
  head.className = "head";

  const key = document.createElement("div");
  key.className = "key";
  key.textContent = data.key;
  head.appendChild(key);

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = data.title || "(titre introuvable)";
  head.appendChild(title);

  // Puces d'info sur les champs détectés.
  const meta = document.createElement("div");
  meta.className = "meta";
  for (const [label, val] of [
    ["Type", data.type],
    ["Statut", data.status],
    ["Assigné", data.assignee],
    ["Priorité", data.priority],
  ]) {
    if (!val) continue;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${label} : <b></b>`;
    chip.querySelector("b").textContent = val;
    meta.appendChild(chip);
  }
  if (meta.childNodes.length) head.appendChild(meta);

  contentEl.appendChild(head);

  const btns = document.createElement("div");
  btns.className = "btns";
  SETTINGS.formats.forEach((f, i) => {
    const preview = window.__jiraTicketHelper.renderTemplate(f.template, data, OPTS);
    const btn = document.createElement("button");
    btn.type = "button";
    if (i === 0) btn.className = "primary";
    btn.title = preview; // aperçu complet au survol (sinon tronqué)
    btn.innerHTML =
      `<span class="ico"></span>` +
      `<span class="body"><span class="label"></span><span class="preview"></span></span>` +
      `<span class="copy-hint">Copier</span>`;
    btn.querySelector(".ico").textContent = iconFor(f.id);
    const labelEl = btn.querySelector(".label");
    labelEl.textContent = f.label;
    // Aperçu sur une seule ligne (les gabarits multi-lignes sont aplatis).
    btn.querySelector(".preview").textContent = preview.replace(/\s+/g, " ").trim();
    btn.addEventListener("click", async () => {
      const ok = await copyAndFlash(preview, btn, labelEl);
      if (ok) {
        await window.JiraSettings.addHistory(
          { key: data.key, title: data.title, url: data.url },
          SETTINGS.historyLimit
        );
        setTimeout(() => window.close(), 700);
      }
    });
    btns.appendChild(btn);
  });
  contentEl.appendChild(btns);

  // Lien vers les options.
  const foot = document.createElement("div");
  foot.className = "foot";
  const opt = document.createElement("a");
  opt.href = "#";
  opt.textContent = "⚙︎ Personnaliser les formats";
  opt.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  foot.appendChild(opt);
  contentEl.appendChild(foot);
}

function renderMulti(tickets) {
  if (!tickets || tickets.length < 2) return;
  multiEl.innerHTML = "";
  const h = document.createElement("h1");
  h.textContent = `${tickets.length} tickets sur cette page`;
  multiEl.appendChild(h);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML =
    `<span class="ico">☑</span>` +
    `<span class="body"><span class="label">Copier la liste</span>` +
    `<span class="preview">Checklist Markdown</span></span>` +
    `<span class="copy-hint">Copier</span>`;
  btn.addEventListener("click", async () => {
    const text = window.__jiraTicketHelper.renderMultiple(
      SETTINGS.multiTemplate,
      tickets,
      OPTS
    );
    await copyAndFlash(text, btn, btn.querySelector(".label"));
  });
  multiEl.appendChild(btn);
}

async function renderHistory() {
  const list = await window.JiraSettings.getHistory();
  if (!list.length) return;
  historyEl.innerHTML = "";

  const head = document.createElement("div");
  head.className = "hist-head";
  const h = document.createElement("h1");
  h.textContent = "Récents";
  head.appendChild(h);
  const clear = document.createElement("a");
  clear.href = "#";
  clear.textContent = "Effacer";
  clear.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.JiraSettings.clearHistory();
    historyEl.innerHTML = "";
  });
  head.appendChild(clear);
  historyEl.appendChild(head);

  for (const entry of list) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "hist-item";
    item.title = `${entry.key} ${entry.title}`;
    item.innerHTML =
      `<span class="ico">🕘</span>` +
      `<span class="body"><span class="hist-key"></span>` +
      `<span class="hist-title"></span></span>` +
      `<span class="copy-hint">Copier</span>`;
    item.querySelector(".hist-key").textContent = entry.key;
    item.querySelector(".hist-title").textContent = entry.title || "";
    item.addEventListener("click", async () => {
      const text = entry.title ? `${entry.key} ${entry.title}` : entry.key;
      await copyAndFlash(text, item, null);
    });
    historyEl.appendChild(item);
  }
}

(async function init() {
  try {
    SETTINGS = await window.JiraSettings.getSettings();
    OPTS = {
      branchPrefixes: SETTINGS.branchPrefixes,
      commitTypes: SETTINGS.commitTypes,
    };

    const tab = await getActiveTab();
    if (!tab?.id) return renderError("Onglet introuvable.");

    const data = await runInPage(tab.id, () => window.__jiraTicketHelper.extract());
    if (!data || !data.ok) {
      renderError(data?.error);
    } else {
      render(data);
    }

    // Multi-tickets (best-effort) — indépendant du ticket unique.
    try {
      const many = await runInPage(tab.id, () =>
        window.__jiraTicketHelper.extractMultiple()
      );
      renderMulti(many);
    } catch (_) {
      /* pas de vue liste : on ignore */
    }

    await renderHistory();
  } catch (e) {
    renderError("Impossible d'accéder à cette page (page interne du navigateur ?).");
    console.error(e);
  }
})();
