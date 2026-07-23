// popup.js — s'exécute quand on clique sur l'icône de l'extension.
// Extrait le ticket dans l'onglet actif puis propose les boutons de copie,
// l'historique et, sur les vues liste/board, la copie multi-tickets.

const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");
const multiEl = document.getElementById("multi");
const historyEl = document.getElementById("history");
const assignEl = document.getElementById("assign");

let SETTINGS = null;
let OPTS = null;
let LAST_FORMAT_ID = null;
let ACTIVE_TAB = null;

// ---- Auto-assignation : état (identique en esprit au panneau latéral) -----
const MAX_ASSIGNEES = window.JiraSettings.MAX_ASSIGNEES || 5;
// Données du ticket courant (base, avant application de l'assigné en attente).
let CURRENT_DATA = null;
// Identité de l'utilisateur courant (« M'assigner »), résolue à la demande.
let MYSELF_CACHE = null;
// Assignation venant d'aboutir : { key, name }. Reflète tout de suite le nouvel
// assigné dans l'en-tête (le DOM Jira et l'API peuvent être en retard).
let PENDING_ASSIGNEE = null;
// La zone « Gérer les personnes » est-elle dépliée ?
let ASSIGN_MANAGE_OPEN = false;

const t = (k, v) => window.JiraI18n.t(k, v);

// Jeu d'icônes SVG unifié (trait, hérite de currentColor). Rendu identique quel
// que soit l'OS, contrairement aux emoji. viewBox 24×24, sans remplissage.
// Repli sur « copy » pour les formats personnalisés.
const ICON_PATHS = {
  full: '<path d="M4 7a2 2 0 0 1 2-2h8l6 6-8 8-8-8V7z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  gitcmd: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><line x1="2" y1="12" x2="8.5" y2="12"/><line x1="15.5" y1="12" x2="22" y2="12"/>',
  markdown: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  key: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  pr: '<line x1="6" y1="9" x2="6" y2="21"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/>',
  multi: '<path d="M10 6h10"/><path d="M10 12h10"/><path d="M10 18h10"/><path d="M3.5 6l1.2 1.2L7 5"/><path d="M3.5 12l1.2 1.2L7 11"/><path d="M3.5 18l1.2 1.2L7 17"/>',
  history: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};
function iconSvg(id) {
  const inner = ICON_PATHS[id] || ICON_PATHS.copy;
  return (
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner +
    "</svg>"
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Exécute une fonction du helper dans la page de l'onglet actif.
async function runInPage(tabId, func, args = []) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["template-engine.js", "extract-core.js", "i18n.js", "extract-fn.js"],
  });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

function setStatus(ok, text) {
  statusEl.className = ok ? "" : "error";
  statusEl.textContent = text;
}

async function copyAndFlash(text, btn, labelEl) {
  const ok = await window.__jiraTicketHelper.copySmart(text);
  setStatus(ok, ok ? t("copied", { text }) : t("copyFailed"));
  if (ok && btn) {
    btn.classList.add("copied");
    if (labelEl) labelEl.textContent = "✓ Copié";
  }
  return ok;
}

// Format à privilégier pour la copie rapide (touche Entrée) : le dernier
// utilisé s'il existe encore, sinon le premier de la liste.
function preferredFormat() {
  const byLast = SETTINGS.formats.find((f) => f.id === LAST_FORMAT_ID);
  return byLast || SETTINGS.formats[0];
}

// État de chargement pendant la détection du ticket (spinner + libellé).
function renderLoading() {
  contentEl.innerHTML = "";
  const box = document.createElement("div");
  box.className = "loading";
  const sp = document.createElement("span");
  sp.className = "spinner";
  sp.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = t("detecting");
  box.append(sp, label);
  contentEl.appendChild(box);
}

function renderError(message) {
  contentEl.innerHTML = "";
  if (assignEl) assignEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const msg = document.createElement("div");
  msg.className = "empty-msg";
  msg.textContent = message || t("noTicket");
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.textContent = t("emptyHint");
  wrap.append(icon, msg, hint);
  contentEl.appendChild(wrap);
  renderManualEntry();
}

// Saisie manuelle d'une clé quand la détection échoue (ex. vue non reconnue).
function renderManualEntry() {
  const form = document.createElement("form");
  form.className = "manual";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t("manualPlaceholder");
  input.autofocus = true;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = t("load");
  form.append(input, submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = (input.value || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
      setStatus(false, t("invalidKey"));
      return;
    }
    setStatus(true, t("loading"));
    let data = await runInPage(ACTIVE_TAB, (k) => window.__jiraTicketHelper.extractFor(k), [key]);
    if (!data || !data.ok) return renderError(t("buildFailed"));
    render(data);
    renderAssignSection();
    await enrichAndRerender(data);
  });
  contentEl.appendChild(form);
  input.focus();
}

// Vrai si un gabarit (format ou multi) référence {parentKey} : évite un appel
// API superflu quand la variable n'est employée nulle part.
function templatesWantParent() {
  const uses = (s) => /\{parentKey\}/.test(s || "");
  return SETTINGS.formats.some((f) => uses(f.template)) || uses(SETTINGS.multiTemplate);
}

// Complète les champs manquants via l'API REST (best-effort) puis re-rend.
async function enrichAndRerender(data) {
  try {
    const opts = { wantParent: templatesWantParent() };
    const enriched = await runInPage(
      ACTIVE_TAB,
      (d, o) => window.__jiraTicketHelper.enrichViaApi(d, o),
      [data, opts]
    );
    if (enriched && enriched.ok) render(enriched);
  } catch (_) {
    /* API indisponible : on garde l'extraction DOM */
  }
}

function buildMeta(data) {
  const meta = document.createElement("div");
  meta.className = "meta";
  for (const [label, val, cls] of [
    [t("type"), data.type, "chip-type"],
    [t("status"), data.status, "chip-status"],
    [t("assignee"), data.assignee, ""],
    [t("priority"), data.priority, "chip-prio"],
  ]) {
    if (!val) continue;
    const chip = document.createElement("span");
    chip.className = "chip" + (cls ? " " + cls : "");
    chip.dataset.value = val.toLowerCase();
    chip.innerHTML = `${label} : <b></b>`;
    chip.querySelector("b").textContent = val;
    meta.appendChild(chip);
  }
  return meta;
}

// Surcharge l'assigné affiché par celui fraîchement posé (retour immédiat,
// le temps que Jira/l'API rattrapent).
function applyPendingAssignee(data) {
  if (data && PENDING_ASSIGNEE && PENDING_ASSIGNEE.key === data.key) {
    return { ...data, assignee: PENDING_ASSIGNEE.name };
  }
  return data;
}

function render(data) {
  // Mémorise la base (clé/titre) puis affiche la vue avec l'assigné en attente.
  CURRENT_DATA = data;
  data = applyPendingAssignee(data);
  contentEl.innerHTML = "";

  const head = document.createElement("div");
  head.className = "head";

  const key = document.createElement("div");
  key.className = "key";
  key.textContent = data.key;
  head.appendChild(key);

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = data.title || t("noTitle");
  head.appendChild(title);

  const meta = buildMeta(data);
  if (meta.childNodes.length) head.appendChild(meta);
  contentEl.appendChild(head);

  const preferredId = preferredFormat().id;
  const btns = document.createElement("div");
  btns.className = "btns";
  SETTINGS.formats.forEach((f, i) => {
    const preview = window.__jiraTicketHelper.renderTemplate(f.template, data, OPTS);
    const btn = document.createElement("button");
    btn.type = "button";
    const isPreferred = f.id === preferredId;
    if (isPreferred) btn.className = "primary";
    btn.title = preview;
    btn.innerHTML =
      `<span class="ico" aria-hidden="true"></span>` +
      `<span class="body"><span class="label"></span><span class="preview"></span></span>` +
      `<span class="copy-hint"></span>` +
      `<span class="hotkey"></span>`;
    btn.querySelector(".ico").innerHTML = iconSvg(f.id);
    btn.querySelector(".copy-hint").textContent = t("copy");
    const labelEl = btn.querySelector(".label");
    labelEl.textContent = f.label;
    if (isPreferred) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t("last");
      labelEl.appendChild(badge);
      btn.dataset.preferred = "1";
    }
    const hk = btn.querySelector(".hotkey");
    if (i < 9) {
      btn.dataset.hotkey = String(i + 1);
      hk.textContent = String(i + 1); // raccourci visible en permanence
    } else {
      hk.remove();
    }
    btn.querySelector(".preview").textContent = preview.replace(/\s+/g, " ").trim();
    btn.addEventListener("click", async () => {
      const ok = await copyAndFlash(preview, btn, labelEl);
      if (ok) {
        LAST_FORMAT_ID = f.id;
        await window.JiraSettings.setLastFormatId(f.id);
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
  contentEl.appendChild(buildShortcutsHelp());
}

// Pied de popup persistant : lien vers les options + rappel des raccourcis.
// Rendu une seule fois (au vrai bas de la popup, sous l'historique).
function renderFoot(paneShortcut) {
  const foot = document.getElementById("foot");
  if (!foot) return;
  foot.innerHTML = "";
  const opt = document.createElement("a");
  opt.href = "#";
  opt.textContent = t("customize");
  opt.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  foot.appendChild(opt);

  // Rappel du raccourci d'ouverture du panneau (découvrabilité).
  if (paneShortcut) {
    const hint = document.createElement("div");
    hint.className = "foot-hint";
    const kbd = document.createElement("kbd");
    kbd.textContent = paneShortcut;
    hint.append(kbd, document.createTextNode(" " + t("footPaneShortcut")));
    foot.appendChild(hint);
  }
}

// Raccourci réel de « toggle-pane » (personnalisable), avec repli sur le défaut
// selon la plateforme si l'API n'est pas disponible ou la commande non liée.
async function getPaneShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === "toggle-pane");
    if (c && c.shortcut) return c.shortcut;
  } catch (_) {
    /* API indisponible : repli plateforme */
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  return isMac ? "⌘⇧Y" : "Ctrl+Shift+Y";
}

// Ligne d'aide des raccourcis, placée juste sous les boutons de copie.
// Met en <kbd> le token de touche (avant « : ») de chaque segment.
function buildShortcutsHelp() {
  const el = document.createElement("div");
  el.className = "shortcuts-help";
  const parts = t("shortcutsHelp").split("·");
  parts.forEach((part, i) => {
    if (i) el.appendChild(document.createTextNode(" · "));
    const m = part.split(":");
    if (m.length === 2) {
      const kbd = document.createElement("kbd");
      kbd.textContent = m[0].trim();
      el.appendChild(kbd);
      el.appendChild(document.createTextNode(" " + m[1].trim()));
    } else {
      el.appendChild(document.createTextNode(part.trim()));
    }
  });
  return el;
}

// Raccourcis clavier : chiffres 1–9 = format correspondant ; Entrée = format
// préféré (dernier utilisé). Installé une seule fois (pas de fuite au re-rendu).
function installHotkeys() {
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const btns = contentEl.querySelector(".btns");
    if (!btns) return;
    if (/^[1-9]$/.test(e.key)) {
      const target = btns.querySelector(`button[data-hotkey="${e.key}"]`);
      if (target) {
        e.preventDefault();
        target.click();
      }
    } else if (e.key === "Enter" && tag !== "BUTTON" && tag !== "A") {
      const target = btns.querySelector('button[data-preferred="1"]') || btns.querySelector("button");
      if (target) {
        e.preventDefault();
        target.click();
      }
    }
  });
}

// ---- Multi-tickets avec sélection par cases ------------------------------
function renderMulti(tickets) {
  if (!tickets || tickets.length < 2) return;
  multiEl.innerHTML = "";

  // Section repliable (ouverte par défaut : c'est l'action principale sur un board).
  const details = document.createElement("details");
  details.className = "section";
  details.open = true;
  const summary = document.createElement("summary");
  const sTitle = document.createElement("span");
  sTitle.className = "sec-title";
  sTitle.textContent = t("ticketsOnPage", { n: tickets.length });
  summary.appendChild(sTitle);
  details.appendChild(summary);
  multiEl.appendChild(details);

  const actions = document.createElement("div");
  actions.className = "sec-actions";
  const toggle = document.createElement("a");
  toggle.href = "#";
  toggle.textContent = t("uncheckAll");
  actions.appendChild(toggle);
  details.appendChild(actions);

  const list = document.createElement("div");
  list.className = "multi-list";
  tickets.forEach((ticket, i) => {
    const row = document.createElement("label");
    row.className = "multi-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.index = String(i);
    const k = document.createElement("span");
    k.className = "hist-key";
    k.textContent = ticket.key;
    const ti = document.createElement("span");
    ti.className = "hist-title";
    ti.textContent = ticket.title || "";
    row.append(cb, k, ti);
    list.appendChild(row);
  });
  details.appendChild(list);

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    const boxes = list.querySelectorAll("input[type=checkbox]");
    const allChecked = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !allChecked));
    toggle.textContent = allChecked ? t("checkAll") : t("uncheckAll");
  });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML =
    `<span class="ico" aria-hidden="true"></span>` +
    `<span class="body"><span class="label"></span>` +
    `<span class="preview"></span></span>` +
    `<span class="copy-hint"></span>`;
  btn.querySelector(".ico").innerHTML = iconSvg("multi");
  btn.querySelector(".label").textContent = t("copySelection");
  btn.querySelector(".preview").textContent = t("checklistMd");
  btn.querySelector(".copy-hint").textContent = t("copy");
  btn.addEventListener("click", async () => {
    const chosen = Array.from(list.querySelectorAll("input:checked")).map(
      (b) => tickets[Number(b.dataset.index)]
    );
    if (!chosen.length) {
      setStatus(false, t("noneSelected"));
      return;
    }
    const text = window.__jiraTicketHelper.renderMultiple(
      SETTINGS.multiTemplate,
      chosen,
      OPTS
    );
    await copyAndFlash(text, btn, btn.querySelector(".label"));
  });
  details.appendChild(btn);
}

async function renderHistory() {
  const list = await window.JiraSettings.getHistory();
  if (!list.length) return;
  historyEl.innerHTML = "";

  // Section repliable, fermée par défaut (secondaire par rapport à la copie).
  const details = document.createElement("details");
  details.className = "section";
  const summary = document.createElement("summary");
  const sTitle = document.createElement("span");
  sTitle.className = "sec-title";
  sTitle.textContent = t("recent");
  const sCount = document.createElement("span");
  sCount.className = "sec-count";
  sCount.textContent = String(list.length);
  summary.append(sTitle, sCount);
  details.appendChild(summary);
  historyEl.appendChild(details);

  const actions = document.createElement("div");
  actions.className = "sec-actions";
  const clear = document.createElement("a");
  clear.href = "#";
  clear.textContent = t("clear");
  clear.addEventListener("click", async (e) => {
    e.preventDefault();
    await window.JiraSettings.clearHistory();
    historyEl.innerHTML = "";
  });
  actions.appendChild(clear);
  details.appendChild(actions);

  const fmt = preferredFormat();
  for (const entry of list) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "hist-item";
    item.title = `${entry.key} ${entry.title || ""}`.trim();
    item.innerHTML =
      `<span class="ico" aria-hidden="true"></span>` +
      `<span class="body"><span class="hist-key"></span>` +
      `<span class="hist-title"></span></span>` +
      `<span class="copy-hint"></span>`;
    item.querySelector(".ico").innerHTML = iconSvg("history");
    item.querySelector(".copy-hint").textContent = t("copy");
    item.querySelector(".hist-key").textContent = entry.key;
    item.querySelector(".hist-title").textContent = entry.title || "";
    item.addEventListener("click", async () => {
      // Utilise le format préféré (au lieu d'un format figé) sur les données
      // conservées (clé/titre/url ; les champs type/statut ne sont pas stockés).
      const text = window.__jiraTicketHelper.renderTemplate(fmt.template, entry, OPTS);
      await copyAndFlash(text, item, null);
    });
    details.appendChild(item);
  }
}

// ---- Auto-assignation ----------------------------------------------------
function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  const s = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  return s.toUpperCase() || "?";
}

// Pastille avatar : image si disponible (repli initiales à l'échec), sinon
// initiales. `size` en px. Styles essentiels posés en inline (identique au
// panneau latéral).
function buildAvatar(person, size) {
  const el = document.createElement("span");
  el.className = "avatar";
  Object.assign(el.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    width: size + "px",
    height: size + "px",
    borderRadius: "50%",
    overflow: "hidden",
    background: "#8fb8f6",
    color: "#fff",
    fontWeight: "700",
    fontSize: Math.round(size * 0.42) + "px",
    lineHeight: "1",
    textTransform: "uppercase",
    userSelect: "none",
  });
  const fallback = () => {
    el.textContent = person.me ? "ME" : initials(person.displayName);
  };
  if (person.avatarUrl) {
    const img = document.createElement("img");
    img.src = person.avatarUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    });
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

// Utilisateur courant (« M'assigner »), résolu via la page (mémoïsé).
async function resolveMe() {
  if (MYSELF_CACHE) return MYSELF_CACHE;
  const me = await runInPage(ACTIVE_TAB, () => window.__jiraTicketHelper.getMyself());
  if (me) MYSELF_CACHE = me;
  return me;
}

// Assigne le ticket courant à `person` (ou à soi-même si person.me). Renvoie
// { ok, name }. Reflète le nouvel assigné et recharge l'onglet Jira (comme le
// panneau : la SPA Jira ne rafraîchit pas seule son champ « Assignee »).
async function performAssign(person) {
  if (!CURRENT_DATA || !CURRENT_DATA.key) return { ok: false, name: "" };
  let target = person;
  if (person.me) {
    target = await resolveMe();
    if (!target) return { ok: false, name: "" };
  }
  const res = await runInPage(
    ACTIVE_TAB,
    (key, acc) => window.__jiraTicketHelper.assignIssue(key, acc),
    [CURRENT_DATA.key, target.accountId]
  );
  if (res && res.ok) {
    PENDING_ASSIGNEE = { key: CURRENT_DATA.key, name: target.displayName };
    render(CURRENT_DATA); // rafraîchit la puce « Assigné » de l'en-tête
    // Recharge l'onglet pour que le champ « Assignee » natif de Jira change aussi.
    try {
      chrome.tabs.reload(ACTIVE_TAB);
    } catch (_) {
      /* onglet inaccessible : on garde au moins le reflet dans le popup */
    }
  }
  return { ok: !!(res && res.ok), name: target.displayName };
}

// Persiste la liste des assignés et met à jour l'état local pour un rendu
// immédiat (le popup n'écoute pas storage.onChanged).
async function saveAssignees(list) {
  SETTINGS.assignees = list;
  await window.JiraSettings.saveSettings(SETTINGS);
}

// Confirmation inline en deux temps (remplace window.confirm, qui casse le
// style et bloque le fil). 1er clic : « arme » le bouton (libellé « Confirmer ? »
// + indice) ; 2e clic dans les CONFIRM_MS : exécute.
const CONFIRM_MS = 4000;

function disarmAssign(btn) {
  if (!btn || !btn.dataset.armed) return;
  window.clearTimeout(Number(btn.dataset.armTimer));
  delete btn.dataset.armed;
  delete btn.dataset.armTimer;
  btn.classList.remove("confirm");
  const labelEl = btn.querySelector(".assign-name");
  if (labelEl && btn.dataset.prevLabel != null) {
    labelEl.textContent = btn.dataset.prevLabel;
    delete btn.dataset.prevLabel;
  }
}

function armAssign(btn) {
  // Un seul bouton armé à la fois.
  assignEl.querySelectorAll(".assign-btn").forEach((b) => {
    if (b !== btn) disarmAssign(b);
  });
  btn.dataset.armed = "1";
  btn.classList.add("confirm");
  const labelEl = btn.querySelector(".assign-name");
  if (labelEl) {
    btn.dataset.prevLabel = labelEl.textContent;
    labelEl.textContent = t("confirmAssignArm");
  }
  setStatus(true, t("confirmAssignHint"));
  btn.dataset.armTimer = String(
    window.setTimeout(() => {
      disarmAssign(btn);
      setStatus(true, "");
    }, CONFIRM_MS)
  );
}

// Assigne depuis le popup, avec statut + état « fait » sur le bouton.
async function assignAndFlash(person, btn) {
  if (btn.dataset.busy) return;
  // Confirmation inline : l'assignation modifie Jira et recharge l'onglet actif.
  if (!btn.dataset.armed) {
    armAssign(btn);
    return;
  }
  disarmAssign(btn);
  btn.dataset.busy = "1";
  setStatus(true, t("assigning"));
  const r = await performAssign(person);
  delete btn.dataset.busy;
  if (!r.ok) {
    setStatus(false, t("assignFailed"));
    return;
  }
  setStatus(true, t("assigned", { name: r.name || person.displayName }));
  btn.classList.add("done");
}

// Un bouton « Assigner à … » (avatar + nom).
function buildAssignButton(person) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "assign-btn";
  btn.title = person.me ? t("assignMe") : t("assignTo", { name: person.displayName });
  btn.appendChild(buildAvatar(person, 24));
  const label = document.createElement("span");
  label.className = "assign-name";
  label.textContent = person.me ? t("assignMe") : person.displayName;
  btn.appendChild(label);
  btn.addEventListener("click", () => assignAndFlash(person, btn));
  return btn;
}

// Zone « Gérer les personnes » : liste courante (retrait) + recherche + ajout.
function buildAssignManage() {
  const wrap = document.createElement("div");
  wrap.className = "assign-manage";

  const current = document.createElement("div");
  current.className = "assign-current";
  SETTINGS.assignees.forEach((p) => {
    const chip = document.createElement("span");
    chip.className = "assign-chip";
    chip.appendChild(buildAvatar(p, 20));
    const nm = document.createElement("span");
    nm.className = "assign-chip-name";
    nm.textContent = p.displayName;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "assign-chip-rm";
    rm.title = t("assignRemove");
    rm.textContent = "×";
    rm.addEventListener("click", async () => {
      await saveAssignees(SETTINGS.assignees.filter((a) => a.accountId !== p.accountId));
      renderAssignSection();
    });
    chip.append(nm, rm);
    current.appendChild(chip);
  });
  wrap.appendChild(current);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "assign-search";
  input.placeholder = t("assignSearch");
  input.disabled = SETTINGS.assignees.length >= MAX_ASSIGNEES;
  wrap.appendChild(input);

  const results = document.createElement("div");
  results.className = "assign-results";
  wrap.appendChild(results);

  const note = document.createElement("div");
  note.className = "assign-note";
  if (SETTINGS.assignees.length >= MAX_ASSIGNEES) {
    note.textContent = t("assignMax", { n: MAX_ASSIGNEES });
  }
  wrap.appendChild(note);

  let searchTimer = 0;
  let searchToken = 0;
  input.addEventListener("input", () => {
    note.textContent = "";
    const q = input.value.trim();
    window.clearTimeout(searchTimer);
    if (!q) {
      results.innerHTML = "";
      return;
    }
    const token = ++searchToken;
    searchTimer = window.setTimeout(async () => {
      results.innerHTML = "";
      note.textContent = t("assignSearching");
      let users = [];
      try {
        users = await runInPage(
          ACTIVE_TAB,
          (query) => window.__jiraTicketHelper.searchUsers(query),
          [q]
        );
      } catch (_) {
        /* réseau : liste vide */
      }
      if (token !== searchToken || !results.isConnected) return;
      note.textContent = "";
      if (!users || !users.length) {
        note.textContent = t("assignNoResult");
        return;
      }
      for (const u of users) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "assign-result";
        row.appendChild(buildAvatar(u, 22));
        const nm = document.createElement("span");
        nm.className = "assign-name";
        nm.textContent = u.displayName;
        row.appendChild(nm);
        const already = SETTINGS.assignees.some((a) => a.accountId === u.accountId);
        if (already) {
          row.disabled = true;
          row.classList.add("in-list");
        }
        row.addEventListener("click", async () => {
          if (SETTINGS.assignees.length >= MAX_ASSIGNEES) {
            note.textContent = t("assignMax", { n: MAX_ASSIGNEES });
            return;
          }
          if (SETTINGS.assignees.some((a) => a.accountId === u.accountId)) {
            note.textContent = t("assignAlready");
            return;
          }
          await saveAssignees([
            ...SETTINGS.assignees,
            {
              accountId: u.accountId,
              displayName: u.displayName,
              avatarUrl: u.avatarUrl || "",
            },
          ]);
          renderAssignSection();
        });
        results.appendChild(row);
      }
    }, 300);
  });

  return wrap;
}

// Section « Assigner à » : boutons (personnes + moi) + zone de gestion
// repliable. Rendue seulement quand un ticket est détecté (comme le panneau).
function renderAssignSection() {
  if (!assignEl) return;
  assignEl.innerHTML = "";
  if (!CURRENT_DATA || !CURRENT_DATA.key) return;

  const heading = document.createElement("h2");
  heading.textContent = t("assignTitle");
  assignEl.appendChild(heading);

  const list = document.createElement("div");
  list.className = "assign-list";
  list.appendChild(buildAssignButton({ me: true, displayName: t("assignMe") }));
  SETTINGS.assignees.forEach((p) => list.appendChild(buildAssignButton(p)));
  assignEl.appendChild(list);

  // Aucune personne configurée : invite discrète à en ajouter.
  if (!SETTINGS.assignees.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = t("assignEmptyPopup");
    assignEl.appendChild(note);
  }

  const toggle = document.createElement("a");
  toggle.href = "#";
  toggle.className = "assign-manage-toggle";
  toggle.textContent = (ASSIGN_MANAGE_OPEN ? "▾ " : "▸ ") + t("assignManage");
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    ASSIGN_MANAGE_OPEN = !ASSIGN_MANAGE_OPEN;
    renderAssignSection();
  });
  assignEl.appendChild(toggle);

  if (ASSIGN_MANAGE_OPEN) assignEl.appendChild(buildAssignManage());
}

(async function init() {
  try {
    SETTINGS = await window.JiraSettings.getSettings();
    window.JiraI18n.setLang(SETTINGS.language || "auto");
    document.querySelector("h1").textContent = t("paneTitle");
    LAST_FORMAT_ID = await window.JiraSettings.getLastFormatId();
    OPTS = {
      branchPrefixes: SETTINGS.branchPrefixes,
      commitTypes: SETTINGS.commitTypes,
      titleCleanups: SETTINGS.titleCleanups,
      stripTags: SETTINGS.stripTags,
    };

    installHotkeys();
    renderFoot(await getPaneShortcut());

    const tab = await getActiveTab();
    if (!tab?.id) return renderError(t("noTab"));
    ACTIVE_TAB = tab.id;

    renderLoading();
    const data = await runInPage(tab.id, () => window.__jiraTicketHelper.extract());
    if (!data || !data.ok) {
      renderError();
    } else {
      render(data);
      renderAssignSection();
      enrichAndRerender(data);
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
    renderError(t("noAccess"));
    console.error(e);
  }
})();
