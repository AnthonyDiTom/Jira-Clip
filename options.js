// options.js — page d'options : gestion des formats de copie + réglages avancés.

const VARS = [
  "key", "title", "titleMd", "slug", "url",
  "type", "status", "assignee", "priority",
  "commitType", "branchPrefix", "branch",
];

// Ticket d'exemple pour les aperçus en direct.
const SAMPLE = {
  key: "DEMO-1234",
  title: "Feature demo - Improve ticket copy examples",
  url: "https://jira.example.com/browse/DEMO-1234",
  type: "Story",
  status: "In Progress",
  assignee: "Alex Demo",
  priority: "Medium",
};

const formatsEl = document.getElementById("formats");
const savedEl = document.getElementById("saved");
const advErrEl = document.getElementById("advErr");
const multiEl = document.getElementById("multiTemplate");
const branchEl = document.getElementById("branchPrefixes");
const commitEl = document.getElementById("commitTypes");
const historyEl = document.getElementById("historyLimit");

// Réglages courants pour les aperçus (maps type→…). Mis à jour à la volée.
function currentOpts() {
  const parse = (el) => {
    try {
      const v = JSON.parse(el.value);
      return v && typeof v === "object" ? v : undefined;
    } catch (_) {
      return undefined;
    }
  };
  return { branchPrefixes: parse(branchEl), commitTypes: parse(commitEl) };
}

function livePreview(template) {
  return window.__jiraTicketHelper.renderTemplate(template, SAMPLE, currentOpts());
}

function renderVarChips() {
  const wrap = document.getElementById("varList");
  for (const v of VARS) {
    const c = document.createElement("code");
    c.textContent = `{${v}}`;
    wrap.appendChild(c);
  }
}

function makeFormatCard(fmt) {
  const card = document.createElement("div");
  card.className = "format";
  card.dataset.id = fmt.id || "";

  const labelRow = document.createElement("div");
  labelRow.className = "row";
  const labelLbl = document.createElement("label");
  labelLbl.textContent = "Libellé";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "f-label";
  labelInput.value = fmt.label || "";
  labelRow.append(labelLbl, labelInput);

  const tplRow = document.createElement("div");
  tplRow.className = "row";
  const tplLbl = document.createElement("label");
  tplLbl.textContent = "Gabarit";
  const tpl = document.createElement("textarea");
  tpl.className = "f-template";
  tpl.rows = fmt.template && fmt.template.includes("\n") ? 5 : 1;
  tpl.value = fmt.template || "";
  tplRow.append(tplLbl, tpl);

  const preview = document.createElement("div");
  preview.className = "preview";
  const refresh = () => {
    preview.textContent = livePreview(tpl.value);
  };
  tpl.addEventListener("input", refresh);

  const actions = document.createElement("div");
  actions.className = "actions";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "icon";
  up.textContent = "↑";
  up.title = "Monter";
  up.addEventListener("click", () => {
    if (card.previousElementSibling) {
      formatsEl.insertBefore(card, card.previousElementSibling);
    }
  });
  const down = document.createElement("button");
  down.type = "button";
  down.className = "icon";
  down.textContent = "↓";
  down.title = "Descendre";
  down.addEventListener("click", () => {
    if (card.nextElementSibling) {
      formatsEl.insertBefore(card.nextElementSibling, card);
    }
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon danger";
  del.textContent = "Supprimer";
  del.addEventListener("click", () => card.remove());
  actions.append(up, down, del);

  card.append(labelRow, tplRow, preview, actions);
  refresh();
  return card;
}

// Reconstruit les aperçus (utile après édition des maps avancées).
function refreshAllPreviews() {
  for (const card of formatsEl.querySelectorAll(".format")) {
    const tpl = card.querySelector(".f-template").value;
    card.querySelector(".preview").textContent = livePreview(tpl);
  }
}

function slugId(label) {
  return (
    "custom-" +
    (label || "format")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) +
    "-" +
    Math.random().toString(36).slice(2, 6)
  );
}

// Collecte les formats depuis le DOM.
function collectFormats() {
  const out = [];
  const seen = new Set();
  for (const card of formatsEl.querySelectorAll(".format")) {
    const label = card.querySelector(".f-label").value.trim();
    const template = card.querySelector(".f-template").value;
    if (!label || !template.trim()) continue;
    let id = card.dataset.id;
    if (!id || seen.has(id)) id = slugId(label);
    seen.add(id);
    out.push({ id, label, template });
  }
  return out;
}

async function load() {
  const s = await window.JiraSettings.getSettings();
  formatsEl.innerHTML = "";
  for (const f of s.formats) formatsEl.appendChild(makeFormatCard(f));
  multiEl.value = s.multiTemplate;
  branchEl.value = JSON.stringify(s.branchPrefixes, null, 2);
  commitEl.value = JSON.stringify(s.commitTypes, null, 2);
  historyEl.value = String(s.historyLimit);
}

async function save() {
  advErrEl.textContent = "";
  let branchPrefixes, commitTypes;
  try {
    branchPrefixes = JSON.parse(branchEl.value);
    commitTypes = JSON.parse(commitEl.value);
  } catch (e) {
    advErrEl.textContent = "JSON invalide dans les réglages avancés : " + e.message;
    return;
  }
  const formats = collectFormats();
  if (!formats.length) {
    advErrEl.textContent = "Au moins un format (libellé + gabarit) est requis.";
    return;
  }
  const historyLimit = Math.max(0, parseInt(historyEl.value, 10) || 0);

  await window.JiraSettings.saveSettings({
    formats,
    multiTemplate: multiEl.value,
    branchPrefixes,
    commitTypes,
    historyLimit,
  });
  savedEl.textContent = "✓ Enregistré";
  setTimeout(() => (savedEl.textContent = ""), 1800);
}

document.getElementById("add").addEventListener("click", () => {
  const card = makeFormatCard({ id: "", label: "Nouveau format", template: "{key} {title}" });
  formatsEl.appendChild(card);
  card.querySelector(".f-label").focus();
});
document.getElementById("save").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", async () => {
  await window.JiraSettings.resetSettings();
  await load();
  savedEl.textContent = "✓ Défauts restaurés";
  setTimeout(() => (savedEl.textContent = ""), 1800);
});
branchEl.addEventListener("input", refreshAllPreviews);
commitEl.addEventListener("input", refreshAllPreviews);

renderVarChips();
load();
