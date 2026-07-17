// page-buttons.js
// Ajoute un bouton dans la barre d'actions Jira et ouvre un panneau lateral.
(function () {
  if (window.__jiraTicketPageCopier) return;
  window.__jiraTicketPageCopier = true;

  const ACTION_ID = "__jira-ticket-copy-action";
  const PANE_ID = "__jira-ticket-copy-pane";
  const CHECK_DELAY = 250;
  const URL_CHECK_INTERVAL = 800;
  const FORMAT_ICONS = {
    full: "🎫",
    branch: "🌿",
    gitcmd: "⎇",
    commit: "✎",
    markdown: "🔗",
    key: "#",
    pr: "⇄",
  };

  let settings = null;
  let opts = null;
  let activeSignature = "";
  let paneOpen = false;
  let lastUrl = location.href;
  let renderTimer = 0;

  function likelyJiraPage() {
    if (/\/browse\/[A-Z][A-Z0-9]+-\d+/.test(location.pathname)) return true;

    const params = new URLSearchParams(location.search);
    if (["selectedIssue", "issue", "issueKey"].some((p) => params.has(p))) {
      return true;
    }

    if (/jira/i.test(document.title)) return true;

    return Boolean(
      document.querySelector(
        [
          '[data-testid*="issue.views"]',
          '[data-testid*="software-backlog"]',
          '[data-testid*="platform-board-kit"]',
          'meta[name="ajs-issue-key"]',
          "#jira",
        ].join(",")
      )
    );
  }

  async function loadSettings() {
    settings = await window.JiraSettings.getSettings();
    opts = {
      branchPrefixes: settings.branchPrefixes,
      commitTypes: settings.commitTypes,
    };
  }

  function removeUi() {
    document.getElementById(ACTION_ID)?.remove();
    document.getElementById(PANE_ID)?.remove();
    activeSignature = "";
    paneOpen = false;
  }

  function getTicketData() {
    const data = window.__jiraTicketHelper.extract();
    return data && data.ok ? data : null;
  }

  function getSignature(data) {
    return `${data.key}|${data.title || ""}`;
  }

  function iconFor(formatId) {
    return FORMAT_ICONS[formatId] || "CP";
  }

  function flattenPreview(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function getButtonText(button) {
    return [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function findWatchButton() {
    const buttons = Array.from(document.querySelectorAll("button, a[role='button']"));
    const visibleTopButtons = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24 && rect.top >= 0 && rect.top < 260;
    });

    return visibleTopButtons.find((button) =>
      /watch|watcher|observer|observateur|suivre|surveill|eye/.test(
        getButtonText(button)
      )
    );
  }

  function findIssueActionContainer() {
    const watchButton = findWatchButton();
    if (watchButton?.parentElement) return watchButton.parentElement;

    const issueShell = document.querySelector(
      [
        '[data-testid*="issue.views.issue-details"]',
        '[data-testid*="issue.views.issue-base"]',
        '[data-testid*="issue-view"]',
        '[role="dialog"]',
        "main",
      ].join(",")
    );
    const buttons = Array.from(
      (issueShell || document).querySelectorAll("button, a[role='button']")
    ).filter((button) => button.getBoundingClientRect().top < 240);

    let best = null;
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      if (!best || rect.right > best.getBoundingClientRect().right) best = button;
    }

    return best?.parentElement || null;
  }

  function createActionButton(data) {
    const button = document.createElement("button");
    button.id = ACTION_ID;
    button.type = "button";
    button.title = `Ouvrir les copies Jira (${data.key})`;
    button.setAttribute("aria-label", `Ouvrir les copies Jira pour ${data.key}`);
    button.innerHTML = `<span class="jtc-action-icon" aria-hidden="true">⧉</span>`;

    Object.assign(button.style, {
      alignItems: "center",
      background: paneOpen ? "#e9f2ff" : "#ffffff",
      border: "1px solid #dfe1e6",
      borderRadius: "3px",
      color: "#172b4d",
      cursor: "pointer",
      display: "inline-flex",
      font: "500 14px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      height: "32px",
      justifyContent: "center",
      marginLeft: "4px",
      padding: "0",
      verticalAlign: "middle",
      width: "32px",
    });

    const icon = button.querySelector(".jtc-action-icon");
    Object.assign(icon.style, {
      color: "#1868db",
      fontSize: "15px",
      lineHeight: "1",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = paneOpen ? "#e9f2ff" : "#f4f5f7";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = paneOpen ? "#e9f2ff" : "#ffffff";
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      paneOpen = !paneOpen;
      renderPane(data);
      scheduleRefresh();
    });

    return button;
  }

  function renderActionButton(data) {
    const existing = document.getElementById(ACTION_ID);
    if (existing) {
      existing.title = `Ouvrir les copies Jira (${data.key})`;
      existing.setAttribute("aria-label", `Ouvrir les copies Jira pour ${data.key}`);
      existing.style.background = paneOpen ? "#e9f2ff" : "#ffffff";
      return true;
    }

    const container = findIssueActionContainer();
    if (!container) return false;

    const button = createActionButton(data);
    const watchButton = findWatchButton();
    if (watchButton?.parentElement === container) {
      watchButton.insertAdjacentElement("afterend", button);
    } else {
      container.insertBefore(button, container.firstChild);
    }

    return true;
  }

  function getPaneRoot() {
    let host = document.getElementById(PANE_ID);
    if (host?.shadowRoot) return host.shadowRoot;

    host = document.createElement("div");
    host.id = PANE_ID;
    document.documentElement.appendChild(host);
    return host.attachShadow({ mode: "open" });
  }

  function removePane() {
    document.getElementById(PANE_ID)?.remove();
    paneOpen = false;
  }

  function setStatus(root, text, isError) {
    const status = root.querySelector("[data-status]");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("error", Boolean(isError));
  }

  async function copyFormat(format, data, button, root) {
    const text = window.__jiraTicketHelper.renderTemplate(format.template, data, opts);
    const ok = await window.__jiraTicketHelper.copyText(text);
    setStatus(root, ok ? "Copié : " + text : "Échec de la copie", !ok);

    if (!ok) return;

    button.classList.add("copied");
    const label = button.querySelector(".label");
    const oldText = label.textContent;
    label.textContent = "✓ Copié";

    await window.JiraSettings.addHistory(
      { key: data.key, title: data.title, url: data.url },
      settings.historyLimit
    );

    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("copied");
      label.textContent = oldText;
      setStatus(root, "", false);
    }, 1200);
  }

  function buildCopyButton(format, data, isPrimary, root) {
    const preview = window.__jiraTicketHelper.renderTemplate(format.template, data, opts);
    const button = document.createElement("button");
    button.type = "button";
    button.className = isPrimary ? "copy primary" : "copy";
    button.title = preview;

    const icon = document.createElement("span");
    icon.className = "ico";
    icon.textContent = iconFor(format.id);

    const body = document.createElement("span");
    body.className = "body";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = format.label;

    const sample = document.createElement("span");
    sample.className = "preview";
    sample.textContent = flattenPreview(preview);

    const hint = document.createElement("span");
    hint.className = "copy-hint";
    hint.textContent = "Copier";

    body.append(label, sample);
    button.append(icon, body, hint);
    button.addEventListener("click", () => copyFormat(format, data, button, root));
    return button;
  }

  function buildTicketHead(data) {
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

    return head;
  }

  function renderPane(data) {
    if (!paneOpen) {
      removePane();
      return;
    }

    const root = getPaneRoot();
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      :host {
        --blue: #1868db;
        --blue-dark: #1558bc;
        --blue-tint: #e9f2ff;
        --bg: #ffffff;
        --bg-sunken: #f7f8f9;
        --fg: #172b4d;
        --muted: #626f86;
        --faint: #8993a4;
        --border: #dfe1e6;
        --border-strong: #c1c7d0;
        --btn-bg: #ffffff;
        --btn-bg-hover: #f4f5f7;
        --ok: #216e4e;
        --ok-bg: #e6f5ef;
        --err: #c9372c;
        --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        --shadow: 0 1px 2px rgba(9, 30, 66, .08);
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --blue: #669df1;
          --blue-dark: #8fb8f6;
          --blue-tint: #1c2b41;
          --bg: #1d2125;
          --bg-sunken: #22272b;
          --fg: #c7d1db;
          --muted: #96a0ab;
          --faint: #738496;
          --border: #38414a;
          --border-strong: #4c5560;
          --btn-bg: #22272b;
          --btn-bg-hover: #282e33;
          --ok: #7ee2b8;
          --ok-bg: #1c3329;
          --err: #fd9891;
          --shadow: 0 1px 2px rgba(0, 0, 0, .3);
        }
      }
      * { box-sizing: border-box; }
      .pane {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        width: min(390px, calc(100vw - 44px));
        display: flex;
        flex-direction: column;
        color: var(--fg);
        background: var(--bg);
        border-left: 1px solid var(--border);
        box-shadow: -12px 0 32px rgba(0, 0, 0, .28);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .pane-bar {
        flex: 0 0 auto;
        min-height: 42px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 5px 8px;
        border-bottom: 1px solid var(--border);
      }
      .pane-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 14px;
      }
      h1 {
        font-size: 11px;
        font-weight: 700;
        margin: 0 0 10px;
        color: var(--faint);
        text-transform: uppercase;
        letter-spacing: .07em;
      }
      .head {
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px 12px 10px;
        margin-bottom: 12px;
      }
      .key {
        font-weight: 700;
        font-size: 15px;
        letter-spacing: .01em;
        color: var(--blue);
        font-family: var(--mono);
      }
      .title {
        margin: 3px 0 0;
        color: var(--fg);
        font-weight: 500;
        word-break: break-word;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin: 10px 0 0;
      }
      .chip {
        font-size: 11px;
        line-height: 1.5;
        color: var(--muted);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 1px 9px;
      }
      .chip b {
        color: var(--fg);
        font-weight: 600;
      }
      .close {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        display: grid;
        place-items: center;
      }
      .close:hover {
        color: var(--fg);
        background: var(--btn-bg-hover);
        border-color: var(--border-strong);
      }
      .btns {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .copy {
        appearance: none;
        width: 100%;
        border: 1px solid var(--border);
        background: var(--btn-bg);
        color: var(--fg);
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background .12s, border-color .12s, box-shadow .12s;
      }
      .copy:hover {
        background: var(--btn-bg-hover);
        border-color: var(--border-strong);
        box-shadow: var(--shadow);
      }
      .copy:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 1px;
      }
      .copy.primary {
        border-color: var(--blue);
        background: var(--blue-tint);
      }
      .ico {
        flex: 0 0 auto;
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: var(--bg-sunken);
        font-size: 14px;
        line-height: 1;
      }
      .copy.primary .ico {
        background: var(--blue);
        color: #fff;
      }
      .copy.primary .label {
        color: var(--blue-dark);
      }
      .copy.copied,
      .copy.copied:hover {
        border-color: var(--ok);
        background: var(--ok-bg);
      }
      .copy.copied .ico {
        background: var(--ok);
        color: #fff;
      }
      .copy.copied .label {
        color: var(--ok);
      }
      .body {
        min-width: 0;
        flex: 1 1 auto;
      }
      .label {
        display: block;
        font-weight: 600;
      }
      .preview {
        display: block;
        margin-top: 1px;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .copy-hint {
        flex: 0 0 auto;
        font-size: 11px;
        color: var(--faint);
        opacity: 0;
        transition: opacity .12s;
      }
      .copy:hover .copy-hint {
        opacity: 1;
      }
      .status {
        margin-top: 10px;
        min-height: 16px;
        font-size: 12px;
        color: var(--ok);
        font-family: var(--mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status.error {
        color: var(--err);
      }
      .foot {
        margin-top: 12px;
      }
      .foot a {
        color: var(--faint);
        font-size: 12px;
        text-decoration: none;
      }
      .foot a:hover {
        color: var(--blue);
        text-decoration: underline;
      }
      @media (max-width: 520px) {
        .pane {
          width: calc(100vw - 16px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; }
      }
    `;

    const pane = document.createElement("aside");
    pane.className = "pane";
    pane.setAttribute("aria-label", "Copies Jira");

    const bar = document.createElement("div");
    bar.className = "pane-bar";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.title = "Fermer";
    close.setAttribute("aria-label", "Fermer le panneau de copie");
    close.textContent = "x";
    close.addEventListener("click", () => {
      removePane();
      scheduleRefresh();
    });

    bar.appendChild(close);

    const body = document.createElement("div");
    body.className = "pane-body";

    const heading = document.createElement("h1");
    heading.textContent = "Ticket Jira";

    body.appendChild(heading);
    body.appendChild(buildTicketHead(data));

    const buttons = document.createElement("div");
    buttons.className = "btns";
    settings.formats.forEach((format, index) => {
      buttons.appendChild(buildCopyButton(format, data, index === 0, root));
    });
    body.appendChild(buttons);

    const status = document.createElement("div");
    status.className = "status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.dataset.status = "";
    body.appendChild(status);

    const foot = document.createElement("div");
    foot.className = "foot";
    const options = document.createElement("a");
    options.href = "#";
    options.textContent = "⚙︎ Personnaliser les formats";
    options.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    foot.appendChild(options);
    body.appendChild(foot);

    pane.append(bar, body);
    root.append(style, pane);
  }

  async function refresh() {
    renderTimer = 0;

    if (!likelyJiraPage()) {
      removeUi();
      return;
    }

    if (!settings) await loadSettings();

    const data = getTicketData();
    if (!data) {
      removeUi();
      return;
    }

    const signature = getSignature(data);
    const signatureChanged = signature !== activeSignature;
    if (signatureChanged) {
      activeSignature = signature;
      removePane();
    }

    const buttonReady = renderActionButton(data);
    if (paneOpen) renderPane(data);

    if (!buttonReady) scheduleRefresh();
  }

  function scheduleRefresh() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(refresh, CHECK_DELAY);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    settings = null;
    opts = null;
    scheduleRefresh();
  });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    activeSignature = "";
    scheduleRefresh();
  }, URL_CHECK_INTERVAL);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !paneOpen) return;
    removePane();
    scheduleRefresh();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRefresh, { once: true });
  } else {
    scheduleRefresh();
  }
})();
