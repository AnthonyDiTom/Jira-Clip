// options.js — page d'options : gestion des formats de copie + réglages avancés.

const t = (k, v) => window.JiraI18n.t(k, v);

const VARS = [
  "key", "title", "titleRaw", "titleMd", "titleLower", "slug", "url",
  "type", "status", "assignee", "priority", "project", "parentKey",
  "commitType", "branchPrefix", "branch", "date",
];

// Dernier gabarit ayant eu le focus : cible d'insertion des puces de variables.
let lastFocusedTemplate = null;

// Ticket d'exemple pour les aperçus en direct.
const SAMPLE = {
  key: "DEMO-1234",
  title: "Feature demo - Improve ticket copy examples",
  url: "https://jira.example.com/browse/DEMO-1234",
  type: "Story",
  status: "In Progress",
  assignee: "Alex Demo",
  priority: "Medium",
  project: "DEMO",
  parentKey: "DEMO-1000",
};

const formatsEl = document.getElementById("formats");

// Affiche un message de confirmation dans tous les emplacements de statut,
// puis l'efface après un délai.
function setSaved(msg) {
  const spans = document.querySelectorAll(".save-status");
  spans.forEach((el) => (el.textContent = msg));
  if (msg) setTimeout(() => spans.forEach((el) => (el.textContent = "")), 1800);
}
const advErrEl = document.getElementById("advErr");
const multiEl = document.getElementById("multiTemplate");
const branchEl = document.getElementById("branchPrefixes");
const commitEl = document.getElementById("commitTypes");
const cleanupsEl = document.getElementById("titleCleanups");
const cleanupsErrEl = document.getElementById("titleCleanupsErr");
const stripTagsEl = document.getElementById("stripTags");
const historyEl = document.getElementById("historyLimit");
const languageEl = document.getElementById("language");

// ---- Sauvegarde unifiée : indicateur « modifications non enregistrées » ----
// Un seul enregistrement couvre formats + multi + réglages avancés. Les listes
// gérées à part (personnes, instances) restent persistées immédiatement.
let dirty = false;
const saveBarEl = document.getElementById("saveBar");
const unsavedEl = document.getElementById("unsaved");

function markDirty() {
  dirty = true;
  if (saveBarEl) saveBarEl.hidden = false;
  if (unsavedEl) unsavedEl.textContent = t("optUnsaved");
}
function markClean() {
  dirty = false;
  if (saveBarEl) saveBarEl.hidden = true;
  if (unsavedEl) unsavedEl.textContent = "";
}
window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

// Traduit les éléments statiques marqués data-i18n / data-i18n-html / data-i18n-ph.
function localize() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

// ---- Éditeur clé→valeur (préfixes de branche / types de commit) -----------
// Remplace l'édition de JSON brut : une ligne = « sous-chaîne du type » → valeur.
// La ligne « default » (repli) est toujours présente et non supprimable.
function kvRow(key, val, isDefault) {
  const row = document.createElement("div");
  row.className = "kv-row";

  const k = document.createElement("input");
  k.type = "text";
  k.className = "kv-key";
  if (isDefault) {
    k.value = "default";
    k.readOnly = true;
    k.classList.add("is-default");
    k.title = t("optDefaultRow");
  } else {
    k.value = key;
    k.placeholder = t("optKeyPh");
  }

  const v = document.createElement("input");
  v.type = "text";
  v.className = "kv-val";
  v.value = val;
  v.placeholder = t("optValuePh");

  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "kv-rm";
  rm.textContent = "×";
  rm.title = t("optRemove");
  rm.disabled = isDefault;
  rm.addEventListener("click", () => {
    row.remove();
    onAdvChange();
  });

  k.addEventListener("input", onAdvChange);
  v.addEventListener("input", onAdvChange);

  row.append(k, v, rm);
  return row;
}

function kvRender(container, obj) {
  container.innerHTML = "";

  const head = document.createElement("div");
  head.className = "kv-head";
  const c1 = document.createElement("span");
  c1.className = "kv-c1";
  c1.textContent = t("optColKey");
  const c2 = document.createElement("span");
  c2.className = "kv-c2";
  c2.textContent = t("optColVal");
  head.append(c1, c2);
  container.appendChild(head);

  for (const [k, val] of Object.entries(obj || {})) {
    if (k === "default") continue;
    container.appendChild(kvRow(k, val, false));
  }
  // « default » toujours en dernier.
  container.appendChild(kvRow("default", (obj && obj.default) || "", true));

  const add = document.createElement("button");
  add.type = "button";
  add.className = "kv-add";
  add.textContent = t("optAddRow");
  add.addEventListener("click", () => {
    const row = kvRow("", "", false);
    container.insertBefore(row, add);
    row.querySelector(".kv-key").focus();
    onAdvChange();
  });
  container.appendChild(add);
}

// Reconstruit l'objet { clé: valeur } depuis les lignes non vides de l'éditeur.
function kvGet(container) {
  const out = {};
  for (const row of container.querySelectorAll(".kv-row")) {
    const k = row.querySelector(".kv-key").value.trim();
    const v = row.querySelector(".kv-val").value.trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

// Édition d'un réglage avancé : marque « non enregistré » + rafraîchit l'aperçu.
function onAdvChange() {
  markDirty();
  refreshAllPreviews();
}

// Réglages courants pour les aperçus (maps type→…). Lus depuis les éditeurs.
function currentOpts() {
  return {
    branchPrefixes: kvGet(branchEl),
    commitTypes: kvGet(commitEl),
    titleCleanups: parseCleanups(cleanupsEl.value),
    stripTags: stripTagsEl.checked,
  };
}

// Motifs de nettoyage du titre : un par ligne, lignes vides ignorées.
function parseCleanups(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Signale sous le champ les motifs de nettoyage dont la regex est invalide.
// Les lignes valides restent exploitables (l'enregistrement n'est pas bloqué).
function validateTitleCleanups() {
  const lines = String(cleanupsEl.value || "").split("\n");
  const bad = window.JiraTemplate.findInvalidCleanups(lines);
  if (!bad.length) {
    cleanupsErrEl.textContent = "";
    return true;
  }
  const details = bad
    .map((b) => t("optLine", { line: b.line, pattern: b.pattern }))
    .join(", ");
  const label = bad.length > 1 ? t("optInvalidPatterns") : t("optInvalidPattern");
  cleanupsErrEl.textContent = `${label} : ${details}.`;
  return false;
}

function livePreview(template) {
  return window.__jiraTicketHelper.renderTemplate(template, SAMPLE, currentOpts());
}

// Insère `text` à la position du curseur dans un <textarea>, puis redéclenche
// l'aperçu en direct et redonne le focus au champ.
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const caret = start + text.length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function renderVarChips() {
  const wrap = document.getElementById("varList");
  wrap.innerHTML = "";
  for (const v of VARS) {
    const c = document.createElement("code");
    c.textContent = `{${v}}`;
    c.tabIndex = 0;
    c.role = "button";
    c.title = t("optInsertVar", { v: `{${v}}` });
    const insert = () => {
      const target = lastFocusedTemplate;
      if (target && target.isConnected) {
        insertAtCursor(target, `{${v}}`);
      } else {
        navigator.clipboard?.writeText(`{${v}}`);
      }
    };
    c.addEventListener("click", insert);
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        insert();
      }
    });
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
  labelLbl.textContent = t("optLibelle");
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "f-label";
  labelInput.value = fmt.label || "";
  labelInput.addEventListener("input", markDirty);
  labelRow.append(labelLbl, labelInput);

  const tplRow = document.createElement("div");
  tplRow.className = "row";
  const tplLbl = document.createElement("label");
  tplLbl.textContent = t("optGabarit");
  const tpl = document.createElement("textarea");
  tpl.className = "f-template";
  tpl.rows = fmt.template && fmt.template.includes("\n") ? 5 : 1;
  tpl.value = fmt.template || "";
  tplRow.append(tplLbl, tpl);

  // Aperçu « texte copié » (brut).
  const textLabel = document.createElement("div");
  textLabel.className = "preview-label";
  textLabel.textContent = t("optPreviewText");
  const preview = document.createElement("div");
  preview.className = "preview";

  // Aperçu « rendu » : le HTML réellement collé dans un éditeur riche, affiché
  // seulement quand la sortie ressemble à du Markdown (cf. copie intelligente).
  const renderedLabel = document.createElement("div");
  renderedLabel.className = "preview-label";
  renderedLabel.textContent = t("optPreviewRendered");
  const rendered = document.createElement("div");
  rendered.className = "preview-rendered";

  const refresh = () => updatePreview(card);
  tpl.addEventListener("input", () => {
    refresh();
    markDirty();
  });
  tpl.addEventListener("focus", () => {
    lastFocusedTemplate = tpl;
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "icon";
  up.textContent = "↑";
  up.title = t("optUp");
  up.addEventListener("click", () => {
    if (card.previousElementSibling) {
      formatsEl.insertBefore(card, card.previousElementSibling);
      markDirty();
    }
  });
  const down = document.createElement("button");
  down.type = "button";
  down.className = "icon";
  down.textContent = "↓";
  down.title = t("optDown");
  down.addEventListener("click", () => {
    if (card.nextElementSibling) {
      formatsEl.insertBefore(card.nextElementSibling, card);
      markDirty();
    }
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon danger";
  del.textContent = t("optDelete");
  del.addEventListener("click", () => {
    card.remove();
    markDirty();
  });
  actions.append(up, down, del);

  card.append(labelRow, tplRow, textLabel, preview, renderedLabel, rendered, actions);
  refresh();
  return card;
}

// Met à jour les deux aperçus d'une carte de format : le texte brut copié et,
// quand la sortie ressemble à du Markdown, le rendu HTML (masqué sinon).
function updatePreview(card) {
  const tpl = card.querySelector(".f-template").value;
  const text = livePreview(tpl);
  card.querySelector(".preview").textContent = text;

  const rendered = card.querySelector(".preview-rendered");
  const renderedLabel = rendered.previousElementSibling;
  const helper = window.__jiraTicketHelper;
  const isMd = helper.looksLikeMarkdown(text);
  rendered.hidden = !isMd;
  renderedLabel.hidden = !isMd;
  // markdownToHtml échappe déjà le HTML (le ticket d'exemple est de toute
  // façon statique) : innerHTML est sûr ici.
  rendered.innerHTML = isMd ? helper.markdownToHtml(text) : "";
}

// Reconstruit les aperçus (utile après édition des maps avancées).
function refreshAllPreviews() {
  for (const card of formatsEl.querySelectorAll(".format")) {
    updatePreview(card);
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
  kvRender(branchEl, s.branchPrefixes);
  kvRender(commitEl, s.commitTypes);
  cleanupsEl.value = (s.titleCleanups || []).join("\n");
  stripTagsEl.checked = s.stripTags === true;
  historyEl.value = String(s.historyLimit);
  languageEl.value = s.language || "auto";
  renderOrigins(s.customOrigins || []);
  renderAssignees(s.assignees || []);
  validateTitleCleanups();
  markClean();
}

// ---- Auto-assignation -----------------------------------------------------
const MAX_ASSIGNEES = window.JiraSettings.MAX_ASSIGNEES || 5;
const assigneeListEl = document.getElementById("assigneeList");
const assigneeSearchEl = document.getElementById("assigneeSearch");
const assigneeResultsEl = document.getElementById("assigneeResults");
const assigneeNoteEl = document.getElementById("assigneeNote");

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// Pastille avatar (image avec repli initiales), `size` en px.
function buildAvatar(person, size) {
  const el = document.createElement("span");
  el.className = "avatar";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.style.fontSize = Math.round(size * 0.42) + "px";
  const fallback = () => {
    el.textContent = initials(person.displayName);
  };
  if (person.avatarUrl) {
    const img = document.createElement("img");
    img.src = person.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
      fallback();
    });
    el.appendChild(img);
  } else {
    fallback();
  }
  return el;
}

function renderAssignees(list) {
  assigneeListEl.innerHTML = "";
  list.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "assignee-item";
    row.appendChild(buildAvatar(p, 26));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.displayName;
    row.appendChild(name);

    const up = document.createElement("button");
    up.type = "button";
    up.className = "icon";
    up.textContent = "↑";
    up.title = t("optUp");
    up.disabled = i === 0;
    up.addEventListener("click", () => moveAssignee(i, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "icon";
    down.textContent = "↓";
    down.title = t("optDown");
    down.disabled = i === list.length - 1;
    down.addEventListener("click", () => moveAssignee(i, 1));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon danger";
    del.textContent = t("optRemove");
    del.addEventListener("click", () => removeAssignee(p.accountId));

    row.append(up, down, del);
    assigneeListEl.appendChild(row);
  });
  assigneeSearchEl.disabled = list.length >= MAX_ASSIGNEES;
  if (list.length >= MAX_ASSIGNEES) {
    assigneeNoteEl.textContent = t("optMaxPeople", { n: MAX_ASSIGNEES });
  } else if (assigneeNoteEl.dataset.kind === "max") {
    assigneeNoteEl.textContent = "";
    delete assigneeNoteEl.dataset.kind;
  }
}

async function persistAssignees(list) {
  const current = await window.JiraSettings.getSettings();
  current.assignees = list.slice(0, MAX_ASSIGNEES);
  await window.JiraSettings.saveSettings(current);
  renderAssignees(current.assignees);
}

async function addAssignee(person) {
  const s = await window.JiraSettings.getSettings();
  const list = s.assignees || [];
  if (list.length >= MAX_ASSIGNEES) {
    assigneeNoteEl.textContent = t("optMaxPeople", { n: MAX_ASSIGNEES });
    assigneeNoteEl.dataset.kind = "max";
    return;
  }
  if (list.some((a) => a.accountId === person.accountId)) {
    assigneeNoteEl.textContent = t("optAlready");
    return;
  }
  await persistAssignees([
    ...list,
    {
      accountId: person.accountId,
      displayName: person.displayName,
      avatarUrl: person.avatarUrl || "",
    },
  ]);
  refreshResultStates();
}

async function removeAssignee(accountId) {
  const s = await window.JiraSettings.getSettings();
  await persistAssignees((s.assignees || []).filter((a) => a.accountId !== accountId));
  refreshResultStates();
}

async function moveAssignee(index, delta) {
  const s = await window.JiraSettings.getSettings();
  const list = [...(s.assignees || [])];
  const j = index + delta;
  if (j < 0 || j >= list.length) return;
  [list[index], list[j]] = [list[j], list[index]];
  await persistAssignees(list);
}

// Recalcule l'état « déjà ajouté » des résultats affichés (sans re-chercher).
async function refreshResultStates() {
  const s = await window.JiraSettings.getSettings();
  const ids = new Set((s.assignees || []).map((a) => a.accountId));
  for (const btn of assigneeResultsEl.querySelectorAll(".assignee-result")) {
    const already = ids.has(btn.dataset.acc);
    btn.disabled = already || (s.assignees || []).length >= MAX_ASSIGNEES;
  }
}

let assigneeSearchTimer = 0;
let assigneeSearchToken = 0;
assigneeSearchEl.addEventListener("input", () => {
  assigneeNoteEl.textContent = "";
  const q = assigneeSearchEl.value.trim();
  window.clearTimeout(assigneeSearchTimer);
  if (!q) {
    assigneeResultsEl.innerHTML = "";
    return;
  }
  const token = ++assigneeSearchToken;
  assigneeSearchTimer = window.setTimeout(async () => {
    assigneeNoteEl.textContent = t("optSearching");
    let resp = { ok: false, results: [] };
    try {
      resp = await chrome.runtime.sendMessage({ type: "search-users", query: q });
    } catch (_) {
      /* worker indisponible */
    }
    if (token !== assigneeSearchToken) return;
    assigneeResultsEl.innerHTML = "";
    if (!resp || !resp.ok) {
      assigneeNoteEl.textContent =
        resp && resp.error === "no-jira-tab" ? t("optOpenJiraTab") : t("optSearchUnavail");
      return;
    }
    assigneeNoteEl.textContent = "";
    const users = resp.results || [];
    if (!users.length) {
      assigneeNoteEl.textContent = t("optNoPerson");
      return;
    }
    const s = await window.JiraSettings.getSettings();
    const ids = new Set((s.assignees || []).map((a) => a.accountId));
    const full = (s.assignees || []).length >= MAX_ASSIGNEES;
    for (const u of users) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "assignee-result";
      btn.dataset.acc = u.accountId;
      btn.disabled = ids.has(u.accountId) || full;
      btn.appendChild(buildAvatar(u, 24));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = u.displayName;
      btn.appendChild(name);
      btn.addEventListener("click", () => addAssignee(u));
      assigneeResultsEl.appendChild(btn);
    }
  }, 300);
});

// ---- Instances Jira personnalisées ---------------------------------------
const originListEl = document.getElementById("originList");
const originInputEl = document.getElementById("originInput");
const originErrEl = document.getElementById("originErr");

// Transforme une saisie en motif "scheme://host/*". Renvoie null si inexploitable.
function toMatchPattern(raw) {
  let v = (raw || "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.hostname}/*`;
  } catch (_) {
    return null;
  }
}

function renderOrigins(origins) {
  originListEl.innerHTML = "";
  for (const o of origins) {
    const li = document.createElement("li");
    li.className = "origin-item";
    const code = document.createElement("code");
    code.textContent = o;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon danger";
    del.textContent = t("optRemove");
    del.addEventListener("click", () => removeOrigin(o));
    li.append(code, del);
    originListEl.appendChild(li);
  }
}

async function persistOrigins(origins) {
  const current = await window.JiraSettings.getSettings();
  current.customOrigins = origins;
  await window.JiraSettings.saveSettings(current);
  renderOrigins(origins);
}

async function addOrigin() {
  originErrEl.textContent = "";
  const pattern = toMatchPattern(originInputEl.value);
  if (!pattern) {
    originErrEl.textContent = t("optOriginInvalid");
    return;
  }
  const s = await window.JiraSettings.getSettings();
  const origins = s.customOrigins || [];
  if (origins.includes(pattern)) {
    originErrEl.textContent = t("optOriginDup");
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    originErrEl.textContent = t("optPermDenied", { msg: e.message });
    return;
  }
  if (!granted) {
    originErrEl.textContent = t("optPermRefused");
    return;
  }
  await persistOrigins([...origins, pattern]);
  originInputEl.value = "";
}

async function removeOrigin(pattern) {
  const s = await window.JiraSettings.getSettings();
  const origins = (s.customOrigins || []).filter((o) => o !== pattern);
  // Révoque la permission hôte (best-effort ; sans effet si partagée).
  try {
    await chrome.permissions.remove({ origins: [pattern] });
  } catch (_) {
    /* ignore */
  }
  await persistOrigins(origins);
}

document.getElementById("originAdd").addEventListener("click", addOrigin);
originInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addOrigin();
  }
});

async function save() {
  advErrEl.textContent = "";
  const branchPrefixes = kvGet(branchEl);
  const commitTypes = kvGet(commitEl);
  const formats = collectFormats();
  if (!formats.length) {
    advErrEl.textContent = t("optNeedFormat");
    return;
  }
  const historyLimit = Math.max(0, parseInt(historyEl.value, 10) || 0);
  const titleCleanups = parseCleanups(cleanupsEl.value);
  const stripTags = stripTagsEl.checked;
  // Signale les motifs invalides sans bloquer : les lignes valides sont tout de
  // même enregistrées (cleanTitle ignore les motifs qui ne compilent pas).
  validateTitleCleanups();

  // Préserve les réglages gérés hors du formulaire principal (instances
  // personnalisées + personnes d'auto-assignation).
  const current = await window.JiraSettings.getSettings();

  await window.JiraSettings.saveSettings({
    formats,
    multiTemplate: multiEl.value,
    branchPrefixes,
    commitTypes,
    titleCleanups,
    stripTags,
    historyLimit,
    language: languageEl.value || "auto",
    customOrigins: current.customOrigins || [],
    assignees: current.assignees || [],
  });
  markClean();
  setSaved(t("optSaved"));
}

document.getElementById("add").addEventListener("click", () => {
  const card = makeFormatCard({ id: "", label: t("optNewFormat"), template: "{key} {title}" });
  formatsEl.appendChild(card);
  card.querySelector(".f-label").focus();
  markDirty();
});
// Une seule affordance de sauvegarde : la barre persistante en bas de page,
// qui apparaît dès qu'une modification est en attente.
document.getElementById("saveSticky").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", async () => {
  // Action destructive : confirmation explicite avant d'effacer formats/réglages.
  if (!window.confirm(t("confirmReset"))) return;
  await window.JiraSettings.resetSettings();
  await load();
  setSaved(t("optResetDone"));
});
multiEl.addEventListener("input", markDirty);
cleanupsEl.addEventListener("input", () => {
  refreshAllPreviews();
  validateTitleCleanups();
  markDirty();
});
stripTagsEl.addEventListener("change", () => {
  refreshAllPreviews();
  markDirty();
});
historyEl.addEventListener("input", markDirty);
languageEl.addEventListener("change", markDirty);

// ---- Export / Import des réglages (JSON) ---------------------------------
document.getElementById("export").addEventListener("click", async () => {
  const s = await window.JiraSettings.getSettings();
  const payload = { app: "jira-ticket-copier", version: 1, settings: s };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `jira-ticket-copier-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setSaved(t("optExported"));
});

const importFileEl = document.getElementById("importFile");
document.getElementById("import").addEventListener("click", () => importFileEl.click());
importFileEl.addEventListener("change", async () => {
  advErrEl.textContent = "";
  const file = importFileEl.files && importFileEl.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Accepte soit l'enveloppe { settings: … }, soit un objet de réglages brut.
    const s = parsed && parsed.settings ? parsed.settings : parsed;
    if (!s || typeof s !== "object" || !Array.isArray(s.formats)) {
      throw new Error("structure inattendue (formats manquants)");
    }
    // Ne conserve que les clés connues, avec des valeurs saines.
    const clean = {
      formats: s.formats
        .filter((f) => f && f.label && f.template)
        .map((f) => ({ id: f.id || slugId(f.label), label: f.label, template: f.template })),
      multiTemplate:
        typeof s.multiTemplate === "string"
          ? s.multiTemplate
          : window.JiraSettings.DEFAULT_MULTI_TEMPLATE,
      branchPrefixes:
        s.branchPrefixes && typeof s.branchPrefixes === "object" ? s.branchPrefixes : {},
      commitTypes:
        s.commitTypes && typeof s.commitTypes === "object" ? s.commitTypes : {},
      titleCleanups: Array.isArray(s.titleCleanups)
        ? s.titleCleanups.filter((p) => typeof p === "string" && p.trim())
        : [],
      stripTags: s.stripTags === true,
      historyLimit: Math.max(0, parseInt(s.historyLimit, 10) || 0),
    };
    if (["auto", "fr", "en"].includes(s.language)) clean.language = s.language;
    if (Array.isArray(s.customOrigins)) clean.customOrigins = s.customOrigins;
    if (Array.isArray(s.assignees)) {
      clean.assignees = s.assignees
        .filter((a) => a && a.accountId && a.displayName)
        .slice(0, MAX_ASSIGNEES)
        .map((a) => ({
          accountId: a.accountId,
          displayName: a.displayName,
          avatarUrl: a.avatarUrl || "",
        }));
    }
    if (!clean.formats.length) throw new Error("aucun format valide");
    await window.JiraSettings.saveSettings(clean);
    await load();
    setSaved(t("optImported"));
  } catch (e) {
    advErrEl.textContent = t("optImportFail", { msg: e.message });
  } finally {
    importFileEl.value = "";
  }
});

// ---- Amorçage -------------------------------------------------------------
(async function init() {
  const s = await window.JiraSettings.getSettings();
  window.JiraI18n.setLang(s.language || "auto");
  localize();
  renderVarChips();
  await load();
})();
