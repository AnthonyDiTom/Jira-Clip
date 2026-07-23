// page-buttons.js
// Ajoute un bouton dans la barre d'actions Jira et ouvre un panneau lateral.
(function () {
  if (window.__jiraTicketPageCopier) return;
  window.__jiraTicketPageCopier = true;

  const ACTION_ID = "__jira-ticket-copy-action";
  const PANE_ID = "__jira-ticket-copy-pane";
  const CHECK_DELAY = 250;
  const URL_CHECK_INTERVAL = 800;
  // Jeu d'icônes SVG unifié (trait, hérite de currentColor). Rendu identique
  // quel que soit l'OS, contrairement aux emoji. Repli sur « copy ».
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

  const t = (k, v) => window.JiraI18n.t(k, v);

  let settings = null;
  let opts = null;
  let lastFormatId = null;
  let activeSignature = "";
  let paneOpen = false;
  let lastUrl = location.href;
  let renderTimer = 0;
  // Cache d'enrichissement API par clé (évite de refetcher à chaque refresh).
  let enrichedKey = null;
  let enrichedData = null;
  // Signature du contenu déjà rendu dans le panneau : on ne le reconstruit que
  // s'il change réellement, sinon les mutations fréquentes de la page Jira
  // écraseraient l'état interne (cases multi-sélection, flash « ✓ Copié »).
  let paneContentSig = "";
  // Cache du style natif échantillonné : getComputedStyle/getBoundingClientRect
  // sont coûteux (reflow) et refresh() peut être appelé très souvent sur un
  // board. On ne ré-échantillonne que si la rangée d'actions change de nœud —
  // ce qui est justement le cas quand Jira re-render la barre (changement de
  // thème, navigation), les deux seuls moments où le style peut varier.
  let sampledRow = null;
  let sampledStyle = null;

  // ---- Auto-assignation : état ---------------------------------------------
  const MAX_ASSIGNEES = window.JiraSettings.MAX_ASSIGNEES || 5;
  const ASSIGN_ACTION_CLASS = "jtc-assign-action";
  // Identité de l'utilisateur courant (« M'assigner »), résolue à la demande.
  let myselfCache = null;
  // Assignation venant d'aboutir : { key, name }. Sert à refléter tout de suite
  // le nouvel assigné (le DOM Jira et l'enrichissement API peuvent être en
  // retard). Réinitialisé au changement de ticket.
  let pendingAssignee = null;
  // La zone « Gérer les personnes » du panneau est-elle dépliée ?
  let assignManageOpen = false;
  // Après une assignation, Jira (SPA) ne rafraîchit pas son champ « Assignee ».
  // On recharge la page pour refléter le changement dans le ticket, en rouvrant
  // le panneau s'il l'était (drapeau conservé le temps du rechargement).
  const REOPEN_KEY = "__jiraTicketReopenPane";
  let reloadTimer = 0;
  let pendingReopenKey = null;
  try {
    const reopen = sessionStorage.getItem(REOPEN_KEY);
    if (reopen) {
      sessionStorage.removeItem(REOPEN_KEY);
      pendingReopenKey = reopen;
    }
  } catch (_) {
    /* sessionStorage indisponible : on ignore la réouverture */
  }

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
    window.JiraI18n.setLang(settings.language || "auto");
    lastFormatId = await window.JiraSettings.getLastFormatId();
    opts = {
      branchPrefixes: settings.branchPrefixes,
      commitTypes: settings.commitTypes,
      titleCleanups: settings.titleCleanups,
      stripTags: settings.stripTags,
    };
  }

  // Format à mettre en avant : le dernier utilisé s'il existe, sinon le 1er.
  function preferredFormat() {
    return settings.formats.find((f) => f.id === lastFormatId) || settings.formats[0];
  }

  // Vrai si un gabarit (format ou multi) référence {parentKey}.
  function templatesWantParent() {
    const uses = (s) => /\{parentKey\}/.test(s || "");
    return settings.formats.some((f) => uses(f.template)) || uses(settings.multiTemplate);
  }

  // Complète les champs manquants via l'API REST (best-effort), une fois par
  // clé, puis relance un rendu pour refléter les données enrichies.
  function ensureEnriched(data) {
    if (enrichedKey === data.key) return; // déjà fait / en cours
    enrichedKey = data.key;
    window.__jiraTicketHelper
      .enrichViaApi(data, { wantParent: templatesWantParent() })
      .then((e) => {
        if (e && e.ok && e.key === enrichedKey) {
          enrichedData = e;
          scheduleRefresh();
        }
      })
      .catch(() => {});
  }

  function removeUi() {
    document.getElementById(ACTION_ID)?.remove();
    document.getElementById(PANE_ID)?.remove();
    document
      .querySelectorAll("." + ASSIGN_ACTION_CLASS)
      .forEach((b) => b.remove());
    activeSignature = "";
    paneOpen = false;
  }

  function getTicketData() {
    const data = window.__jiraTicketHelper.extract();
    return data && data.ok ? data : null;
  }

  function getSignature(data) {
    // Basé sur la clé seule : l'enrichissement API peut compléter le titre
    // sans qu'on considère qu'il s'agit d'un autre ticket (sinon le panneau
    // se refermerait à l'arrivée des données enrichies).
    return data.key;
  }

  // Signature du contenu du panneau (ticket unique). Volontairement
  // indépendante de la liste multi-tickets : sur un board qui mute sans cesse,
  // on ne veut pas reconstruire le panneau et perdre la sélection en cours.
  function paneSignature(data) {
    return [
      data.key,
      data.title || "",
      data.type || "",
      data.status || "",
      data.assignee || "",
      data.priority || "",
    ].join("|");
  }

  function iconSvg(id) {
    const inner = ICON_PATHS[id] || ICON_PATHS.copy;
    return (
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner +
      "</svg>"
    );
  }

  function flattenPreview(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  // ---- Auto-assignation : helpers ------------------------------------------
  function initials(name) {
    const parts = (name || "").trim().split(/\s+/);
    const s = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
    return s.toUpperCase() || "?";
  }

  // Pastille avatar : image si disponible (repli initiales à l'échec), sinon
  // initiales. `size` en px. Les styles essentiels sont posés en inline pour
  // fonctionner aussi bien dans le DOM de la page (barre d'actions) que dans le
  // shadow DOM (panneau).
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

  // Petit toast dans la page (feedback d'assignation depuis la barre d'actions,
  // où le panneau peut être fermé). Calqué sur celui de extract-fn.
  function pageToast(message, isError, variant) {
    const id = "__jira-assign-toast";
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
      background: isError ? "#c9372c" : variant === "warn" ? "#b45309" : "#1868db",
      boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      transition: "opacity .3s",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  // ---- Confirmation inline en deux temps (remplace window.confirm) ---------
  // 1er clic : « arme » le bouton ; 2e clic dans les CONFIRM_MS : exécute.
  const CONFIRM_MS = 4000;

  // Panneau : bouton pilule avec libellé « Confirmer ? » + indice de statut.
  function disarmPaneAssign(btn) {
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
  function armPaneAssign(btn, root) {
    root.querySelectorAll(".assign-btn").forEach((b) => {
      if (b !== btn) disarmPaneAssign(b);
    });
    btn.dataset.armed = "1";
    btn.classList.add("confirm");
    const labelEl = btn.querySelector(".assign-name");
    if (labelEl) {
      btn.dataset.prevLabel = labelEl.textContent;
      labelEl.textContent = t("confirmAssignArm");
    }
    setStatus(root, t("confirmAssignHint"), false);
    btn.dataset.armTimer = String(
      window.setTimeout(() => {
        disarmPaneAssign(btn);
        setStatus(root, "", false);
      }, CONFIRM_MS)
    );
  }

  // Barre d'actions : bouton avatar seul, indice via toast + liseré d'attention.
  function disarmActionAssign(btn) {
    if (!btn || !btn.dataset.armed) return;
    window.clearTimeout(Number(btn.dataset.armTimer));
    delete btn.dataset.armed;
    delete btn.dataset.armTimer;
    btn.style.outline = "";
    btn.style.outlineOffset = "";
  }
  function armActionAssign(btn, person, data) {
    document.querySelectorAll("." + ASSIGN_ACTION_CLASS).forEach((b) => {
      if (b !== btn) disarmActionAssign(b);
    });
    btn.dataset.armed = "1";
    btn.style.outline = "2px solid #b45309";
    btn.style.outlineOffset = "1px";
    const who = person.me ? t("assignMeShort") : person.displayName;
    pageToast(t("confirmAssignArmToast", { key: data.key, name: who }), false, "warn");
    btn.dataset.armTimer = String(
      window.setTimeout(() => disarmActionAssign(btn), CONFIRM_MS)
    );
  }

  // Résout l'utilisateur courant pour « M'assigner » (mémoïsé).
  async function resolveMe() {
    if (myselfCache) return myselfCache;
    const me = await window.__jiraTicketHelper.getMyself();
    if (me) myselfCache = me;
    return me;
  }

  // Assigne le ticket courant à `person` (ou à soi-même si person.me).
  // Renvoie { ok, name }. Met à jour pendingAssignee et relance un rendu.
  // La confirmation se fait en amont (inline, deux temps) chez l'appelant.
  async function performAssign(person, data) {
    let target = person;
    if (person.me) {
      target = await resolveMe();
      if (!target) return { ok: false, name: "" };
    }
    const res = await window.__jiraTicketHelper.assignIssue(data.key, target.accountId);
    if (res.ok) {
      pendingAssignee = { key: data.key, name: target.displayName };
      // L'assigné a changé : on invalide le cache d'enrichissement pour que la
      // prochaine lecture API reflète la nouvelle valeur.
      enrichedKey = null;
      enrichedData = null;
      scheduleRefresh();
      // Puis on recharge la page pour que le champ « Assignee » natif de Jira
      // affiche aussi le changement.
      scheduleReloadForAssign(data.key);
    }
    return { ok: res.ok, name: target.displayName };
  }

  // Recharge la page peu après une assignation (temps de voir le toast), en
  // mémorisant l'état ouvert du panneau pour le rouvrir ensuite. Le minuteur est
  // ré-armé à chaque assignation pour laisser passer les clics rapprochés.
  function scheduleReloadForAssign(key) {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      try {
        if (paneOpen) sessionStorage.setItem(REOPEN_KEY, key);
      } catch (_) {
        /* sessionStorage indisponible : rechargement sans réouverture */
      }
      location.reload();
    }, 700);
  }

  // Applique un assigné fraîchement posé à la vue (le DOM/API peuvent être en
  // retard), pour un retour visuel immédiat.
  function applyPendingAssignee(view) {
    if (pendingAssignee && pendingAssignee.key === view.key) {
      return { ...view, assignee: pendingAssignee.name };
    }
    return view;
  }

  // Persiste la liste des assignés (réglages complets) et met à jour l'état
  // local pour un rendu immédiat.
  async function saveAssignees(list) {
    settings.assignees = list;
    await window.JiraSettings.saveSettings(settings);
  }

  function getButtonText(button) {
    const parts = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent,
    ];
    // Les vues modernes de Jira posent souvent le data-testid parlant sur un
    // conteneur parent (le <button> lui-même ne porte qu'une icône). On remonte
    // donc quelques niveaux pour récupérer ces identifiants.
    let node = button.parentElement;
    for (let depth = 0; depth < 3 && node; depth++) {
      const testid = node.getAttribute && node.getAttribute("data-testid");
      if (testid) parts.push(testid);
      node = node.parentElement;
    }
    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  // Conteneur de l'issue courante : panneau latéral « Jira work item » ouvert
  // depuis le board/backlog, ou vue détaillée classique. On s'y restreint pour
  // ne pas attraper les boutons du board en arrière-plan.
  function issueScope() {
    const selectors = [
      '[data-testid*="issue.views.issue-details"]',
      '[data-testid*="issue.views.issue-base"]',
      '[data-testid*="issue-view"]',
      '[role="dialog"]',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return document;
  }

  function visibleTopButtons(scope) {
    return Array.from(
      (scope || issueScope()).querySelectorAll("button, a[role='button']")
    ).filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24 && rect.top >= 0 && rect.top < 260;
    });
  }

  function findCopyLinkButton() {
    return visibleTopButtons().find((button) =>
      /copy link|copier le lien|copy url|lien de copie|kopieer link/.test(
        getButtonText(button)
      )
    );
  }

  function findWatchButton() {
    return visibleTopButtons().find((button) =>
      /watch|watcher|observer|observateur|suivre|surveill|eye/.test(
        getButtonText(button)
      )
    );
  }

  function findShareButton() {
    return visibleTopButtons().find((button) =>
      /share|partager|delen|teilen/.test(getButtonText(button))
    );
  }

  function findMoreActionsButton() {
    return visibleTopButtons().find((button) =>
      /more actions|more-actions|meatball|plus d'actions|meer acties|weitere aktionen/.test(
        getButtonText(button)
      )
    );
  }

  // Bouton d'ancrage de repli : « Copy link » en priorité, puis « Watch » /
  // « Share » / « … » (vues non standard sans les data-testid attendus).
  function findAnchorButton() {
    return (
      findCopyLinkButton() ||
      findWatchButton() ||
      findShareButton() ||
      findMoreActionsButton()
    );
  }

  // Repère la rangée d'actions de l'en-tête d'issue (œil / partage / …), commune
  // à la vue détaillée et au panneau latéral, via les data-testid stables de Jira.
  // Renvoie { row, ref } : `row` = conteneur flex, `ref` = élément après lequel
  // insérer le bouton (le wrapper de l'œil), ou null si non rendu.
  function findHeaderActionsRow() {
    const watch = document.querySelector(
      '[data-testid="issue.watchers.action-button.root"]'
    );
    const meatball = document.querySelector(
      '[data-testid="issue-meatball-menu.ui.dropdown-trigger.button"]'
    );

    if (watch && meatball) {
      const watchAncestors = [];
      for (let node = watch; node; node = node.parentElement) {
        watchAncestors.push(node);
      }
      // Plus proche ancêtre commun = la rangée d'actions.
      let row = null;
      for (let node = meatball; node; node = node.parentElement) {
        if (watchAncestors.includes(node)) {
          row = node;
          break;
        }
      }
      if (row) {
        // Enfant direct de la rangée contenant l'œil : on insère juste après.
        let ref = watch;
        while (ref && ref.parentElement !== row) ref = ref.parentElement;
        return { row, ref };
      }
    }

    const anchor = watch || meatball;
    if (anchor?.parentElement) return { row: anchor.parentElement, ref: anchor };
    return null;
  }

  // Cible d'insertion : rangée d'actions officielle, sinon repli heuristique.
  function findActionTarget() {
    const header = findHeaderActionsRow();
    if (header) return header;

    const anchorButton = findAnchorButton();
    if (anchorButton?.parentElement) {
      return { row: anchorButton.parentElement, ref: anchorButton };
    }
    return null;
  }

  // Luminance perçue (0 = noir, 1 = blanc) d'une couleur CSS « rgb(...) ».
  function luminance(color) {
    const m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(color || "");
    if (!m) return 0.2; // à défaut, on suppose un thème clair
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // Relève les métriques d'un bouton d'action natif voisin (couleur d'icône,
  // taille, arrondi) pour que notre bouton se fonde dans la barre quel que soit
  // le thème Jira (clair/sombre) et la version de l'interface. On en déduit
  // aussi si le thème est sombre, via la luminance de la couleur du texte natif.
  // Vrai si une couleur CSS est absente ou totalement transparente.
  function isTransparent(color) {
    if (!color || color === "transparent") return true;
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return false;
    const parts = m[1].split(",").map((s) => s.trim());
    return parts.length === 4 && parseFloat(parts[3]) === 0;
  }

  function sampleNativeStyle(row) {
    const fallback = {
      color: "#44546f",
      size: 32,
      radius: "3px",
      border: null,
      background: null,
      dark: false,
    };
    if (!row) return fallback;
    const native = Array.from(
      row.querySelectorAll("button, a[role='button']")
    ).find((b) => b.id !== ACTION_ID && b.getBoundingClientRect().height >= 24);
    if (!native) return fallback;

    const cs = getComputedStyle(native);
    const size = Math.round(native.getBoundingClientRect().height) || fallback.size;
    const radius =
      cs.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : fallback.radius;
    const hasBorder =
      parseFloat(cs.borderTopWidth) > 0 &&
      cs.borderTopStyle !== "none" &&
      !isTransparent(cs.borderTopColor);
    return {
      color: cs.color || fallback.color,
      size,
      radius,
      // Bordure/fond au repos calqués sur le bouton natif (certaines vues Jira
      // encadrent leurs boutons d'action, d'autres non).
      border: hasBorder
        ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`
        : null,
      background: isTransparent(cs.backgroundColor) ? null : cs.backgroundColor,
      dark: luminance(cs.color) > 0.6, // texte clair ⇒ fond sombre
    };
  }

  // Applique la couleur/taille/état visuel calqués sur le bouton natif. Appelé à
  // la création puis à chaque rendu (le panneau peut s'ouvrir/fermer, et Jira
  // peut re-render la barre en changeant de thème).
  function paintActionButton(button, style) {
    const hoverBg = style.dark ? "rgba(255,255,255,.10)" : "rgba(9,30,66,.06)";
    const activeBg = style.dark ? "rgba(88,152,232,.24)" : "#e9f2ff";
    const activeFg = style.dark ? "#85b8ff" : "#1868db";
    // Bordure : celle du bouton natif si elle existe, sinon un liseré neutre
    // adapté au thème pour rester cohérent avec « les autres boutons ».
    const border =
      style.border || (style.dark ? "1px solid rgba(255,255,255,.22)" : "1px solid #c1c7d0");
    const restBg = style.background || "transparent";
    button.dataset.hoverBg = hoverBg;
    button.dataset.activeBg = activeBg;
    button.dataset.restBg = restBg;

    button.style.boxSizing = "border-box";
    button.style.width = style.size + "px";
    button.style.height = style.size + "px";
    button.style.borderRadius = style.radius;
    button.style.border = border;
    button.style.background = paneOpen ? activeBg : restBg;

    const icon = button.querySelector(".jtc-action-icon");
    if (icon) icon.style.color = paneOpen ? activeFg : style.color;
  }

  function createActionButton(data) {
    const button = document.createElement("button");
    button.id = ACTION_ID;
    button.type = "button";
    button.title = t("openCopies", { key: data.key });
    button.setAttribute("aria-label", t("openCopiesAria", { key: data.key }));
    button.innerHTML = `<span class="jtc-action-icon" aria-hidden="true">⧉</span>`;

    Object.assign(button.style, {
      alignItems: "center",
      background: "transparent",
      cursor: "pointer",
      display: "inline-flex",
      flex: "0 0 auto",
      font: "500 14px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      justifyContent: "center",
      marginLeft: "2px",
      padding: "0",
      transition: "background .1s ease, border-color .1s ease",
      verticalAlign: "middle",
    });

    const icon = button.querySelector(".jtc-action-icon");
    Object.assign(icon.style, {
      fontSize: "16px",
      lineHeight: "1",
    });

    button.addEventListener("mouseenter", () => {
      if (paneOpen) return;
      button.style.background = button.dataset.hoverBg || "rgba(9,30,66,.06)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = paneOpen
        ? button.dataset.activeBg || "#e9f2ff"
        : button.dataset.restBg || "transparent";
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

  // Diamètre de l'avatar d'un bouton d'assignation (barre d'actions).
  function assignAvatarSize(style) {
    return Math.max(18, (style.size || 28) - 8);
  }

  function paintAssignActionButton(button, style) {
    const restBg = style.background || "transparent";
    button.dataset.restBg = restBg;
    button.dataset.hoverBg = style.dark ? "rgba(255,255,255,.10)" : "rgba(9,30,66,.06)";
    // Bouton resserré autour de l'avatar (pas la pleine largeur d'un bouton
    // natif) pour rapprocher les personnes ; hauteur alignée sur la rangée.
    button.style.width = assignAvatarSize(style) + 4 + "px";
    button.style.height = style.size + "px";
    button.style.background = restBg;
  }

  function createAssignActionButton(person, data, style) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ASSIGN_ACTION_CLASS;
    button.dataset.acc = person.me ? "__me__" : person.accountId;
    button.title = person.me ? t("assignMe") : t("assignTo", { name: person.displayName });
    button.setAttribute("aria-label", button.title);
    Object.assign(button.style, {
      alignItems: "center",
      background: "transparent",
      border: "none",
      borderRadius: "50%",
      boxSizing: "border-box",
      cursor: "pointer",
      display: "inline-flex",
      flex: "0 0 auto",
      justifyContent: "center",
      marginLeft: "0",
      padding: "0",
      transition: "background .1s ease",
      verticalAlign: "middle",
    });

    button.appendChild(buildAvatar(person, assignAvatarSize(style)));

    button.addEventListener("mouseenter", () => {
      button.style.background = button.dataset.hoverBg || "rgba(9,30,66,.06)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = button.dataset.restBg || "transparent";
    });
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.busy) return;
      // Confirmation inline : 1er clic arme, 2e clic (dans CONFIRM_MS) exécute.
      if (!button.dataset.armed) {
        armActionAssign(button, person, data);
        return;
      }
      disarmActionAssign(button);
      button.dataset.busy = "1";
      const r = await performAssign(person, data);
      delete button.dataset.busy;
      pageToast(
        r.ok ? t("assigned", { name: r.name || person.displayName }) : t("assignFailed"),
        !r.ok
      );
    });

    paintAssignActionButton(button, style);
    return button;
  }

  // Boutons d'assignation de la barre d'actions : un par personne configurée
  // (max 5) plus « M'assigner ». Insérés juste après le bouton ⧉. Reconstruits
  // seulement quand la liste change (sinon repeints : l'observer n'écoute que
  // les ajouts/retraits de nœuds, donc ne boucle pas).
  function renderAssignActionButtons(data, style) {
    const anchor = document.getElementById(ACTION_ID);
    if (!anchor || !anchor.parentElement) return;
    const row = anchor.parentElement;

    const people = [
      ...settings.assignees.slice(0, MAX_ASSIGNEES),
      { me: true, displayName: t("assignMe") },
    ];
    const sig = people.map((p) => (p.me ? "__me__" : p.accountId)).join(",");

    // Recherche à l'échelle du document : si Jira re-rend la barre, le bouton ⧉
    // est ré-ancré et d'anciens boutons d'assignation pourraient rester
    // orphelins ailleurs — on les nettoie tous avant de reconstruire.
    const existing = Array.from(document.querySelectorAll("." + ASSIGN_ACTION_CLASS));
    const inRow = existing.filter((b) => b.parentElement === row);
    const domSig = inRow.map((b) => b.dataset.acc).join(",");
    if (inRow.length === existing.length && inRow.length && domSig === sig) {
      inRow.forEach((b) => paintAssignActionButton(b, style));
      return;
    }

    existing.forEach((b) => b.remove());
    let ref = anchor;
    for (const person of people) {
      const btn = createAssignActionButton(person, data, style);
      ref.insertAdjacentElement("afterend", btn);
      ref = btn;
    }
  }

  // Style natif de la rangée, mémoïsé tant que le nœud de la rangée ne change pas.
  function currentNativeStyle(row) {
    if (row && row === sampledRow && sampledStyle) return sampledStyle;
    sampledStyle = sampleNativeStyle(row);
    sampledRow = row || null;
    return sampledStyle;
  }

  function renderActionButton(data) {
    const target = findActionTarget();
    const style = currentNativeStyle(target && target.row);

    const existing = document.getElementById(ACTION_ID);
    if (existing) {
      existing.title = t("openCopies", { key: data.key });
      existing.setAttribute("aria-label", t("openCopiesAria", { key: data.key }));
      paintActionButton(existing, style);
      // La rangée d'actions peut avoir été re-rendue par Jira : on réancre au
      // besoin pour ne pas laisser le bouton orphelin ailleurs dans la page.
      if (target && existing.parentElement !== target.row) {
        if (target.ref && target.ref.parentElement === target.row) {
          target.ref.insertAdjacentElement("afterend", existing);
        } else {
          target.row.appendChild(existing);
        }
      }
      renderAssignActionButtons(data, style);
      return true;
    }

    if (!target) return false;

    const button = createActionButton(data);
    paintActionButton(button, style);
    if (target.ref && target.ref.parentElement === target.row) {
      target.ref.insertAdjacentElement("afterend", button);
    } else {
      target.row.appendChild(button);
    }

    renderAssignActionButtons(data, style);
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
    paneContentSig = "";
  }

  function setStatus(root, text, isError) {
    const status = root.querySelector("[data-status]");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("error", Boolean(isError));
  }

  // Copie `text`, affiche le statut et fait clignoter le bouton en « ✓ Copié ».
  // Renvoie true si la copie a réussi.
  async function copyAndFlash(text, button, root) {
    const ok = await window.__jiraTicketHelper.copySmart(text);
    setStatus(root, ok ? t("copied", { text }) : t("copyFailed"), !ok);

    if (!ok) return false;

    button.classList.add("copied");
    const label = button.querySelector(".label");
    const oldText = label ? label.textContent : null;
    if (label) label.textContent = t("copiedShort");

    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("copied");
      if (label) label.textContent = oldText;
      setStatus(root, "", false);
    }, 1200);

    return true;
  }

  async function copyFormat(format, data, button, root) {
    const text = window.__jiraTicketHelper.renderTemplate(format.template, data, opts);
    const ok = await copyAndFlash(text, button, root);
    if (!ok) return;

    lastFormatId = format.id;
    window.JiraSettings.setLastFormatId(format.id);
    await window.JiraSettings.addHistory(
      { key: data.key, title: data.title, url: data.url },
      settings.historyLimit
    );
    // Rafraîchit la section « Récents » pour refléter la nouvelle entrée.
    renderHistorySection(root);
  }

  function buildCopyButton(format, data, isPrimary, root) {
    const preview = window.__jiraTicketHelper.renderTemplate(format.template, data, opts);
    const button = document.createElement("button");
    button.type = "button";
    button.className = isPrimary ? "copy primary" : "copy";
    button.title = preview;

    const icon = document.createElement("span");
    icon.className = "ico";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg(format.id);

    const body = document.createElement("span");
    body.className = "body";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = format.label;
    if (isPrimary) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t("last");
      label.appendChild(badge);
    }

    const sample = document.createElement("span");
    sample.className = "preview";
    sample.textContent = flattenPreview(preview);

    const hint = document.createElement("span");
    hint.className = "copy-hint";
    hint.textContent = t("copy");

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
    title.textContent = data.title || t("noTitle");
    head.appendChild(title);

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
    if (meta.childNodes.length) head.appendChild(meta);

    return head;
  }

  // Section « copie multi-tickets » (vues liste / board / backlog).
  // Rendue au mieux : sans vue liste détectée, la section reste vide.
  function renderMultiSection(root) {
    const container = root.querySelector("[data-multi]");
    if (!container) return;
    container.innerHTML = "";

    let tickets = null;
    try {
      tickets = window.__jiraTicketHelper.extractMultiple();
    } catch (_) {
      return;
    }
    if (!tickets || tickets.length < 2) return;

    // Section repliable (ouverte par défaut : action principale sur un board).
    const details = document.createElement("details");
    details.className = "section";
    details.open = true;
    const summary = document.createElement("summary");
    const sTitle = document.createElement("span");
    sTitle.className = "sec-title";
    sTitle.textContent = t("ticketsOnPage", { n: tickets.length });
    summary.appendChild(sTitle);
    details.appendChild(summary);
    container.appendChild(details);

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

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      const boxes = list.querySelectorAll("input[type=checkbox]");
      const allChecked = Array.from(boxes).every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !allChecked));
      toggle.textContent = allChecked ? t("checkAll") : t("uncheckAll");
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";

    const icon = document.createElement("span");
    icon.className = "ico";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg("multi");

    const body = document.createElement("span");
    body.className = "body";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = t("copySelection");
    const sample = document.createElement("span");
    sample.className = "preview";
    sample.textContent = t("checklistMd");
    body.append(label, sample);

    const hint = document.createElement("span");
    hint.className = "copy-hint";
    hint.textContent = t("copy");

    button.append(icon, body, hint);
    button.addEventListener("click", () => {
      const chosen = Array.from(list.querySelectorAll("input:checked")).map(
        (b) => tickets[Number(b.dataset.index)]
      );
      if (!chosen.length) {
        setStatus(root, t("noneSelected"), true);
        return;
      }
      const text = window.__jiraTicketHelper.renderMultiple(
        settings.multiTemplate,
        chosen,
        opts
      );
      copyAndFlash(text, button, root);
    });
    details.appendChild(button);
  }

  // Section « Récents » — historique des tickets copiés (stockage local).
  async function renderHistorySection(root) {
    const container = root.querySelector("[data-history]");
    if (!container) return;

    const list = await window.JiraSettings.getHistory();
    // Le panneau a pu être fermé/recréé entre-temps : on revérifie.
    if (!container.isConnected) return;
    container.innerHTML = "";
    if (!list.length) return;

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
    container.appendChild(details);

    const actions = document.createElement("div");
    actions.className = "sec-actions";
    const clear = document.createElement("a");
    clear.href = "#";
    clear.textContent = t("clear");
    clear.addEventListener("click", async (event) => {
      event.preventDefault();
      await window.JiraSettings.clearHistory();
      container.innerHTML = "";
    });
    actions.appendChild(clear);
    details.appendChild(actions);

    for (const entry of list) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "copy hist-item";
      item.title = `${entry.key} ${entry.title || ""}`.trim();

      const icon = document.createElement("span");
      icon.className = "ico";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = iconSvg("history");

      const body = document.createElement("span");
      body.className = "body";
      const key = document.createElement("span");
      key.className = "hist-key";
      key.textContent = entry.key;
      const title = document.createElement("span");
      title.className = "hist-title";
      title.textContent = entry.title || "";
      body.append(key, title);

      const hint = document.createElement("span");
      hint.className = "copy-hint";
      hint.textContent = t("copy");

      item.append(icon, body, hint);
      item.addEventListener("click", () => {
        const text = window.__jiraTicketHelper.renderTemplate(
          preferredFormat().template,
          entry,
          opts
        );
        copyAndFlash(text, item, root);
      });
      details.appendChild(item);
    }
  }

  // Assigne depuis le panneau, avec statut + clignotement du bouton.
  async function assignAndFlash(person, data, button, root) {
    if (button.dataset.busy) return;
    // Confirmation inline : 1er clic arme, 2e clic (dans CONFIRM_MS) exécute.
    if (!button.dataset.armed) {
      armPaneAssign(button, root);
      return;
    }
    disarmPaneAssign(button);
    button.dataset.busy = "1";
    setStatus(root, t("assigning"), false);
    const r = await performAssign(person, data);
    delete button.dataset.busy;
    if (!r.ok) {
      setStatus(root, t("assignFailed"), true);
      return;
    }
    setStatus(root, t("assigned", { name: r.name || person.displayName }), false);
    button.classList.add("done");
    // scheduleRefresh() (déclenché par performAssign) reconstruira le panneau
    // avec la nouvelle puce « Assigné » ; le clignotement est un retour immédiat.
  }

  // Un bouton « Assigner à … » (avatar + nom) dans le panneau.
  function buildAssignPanelButton(person, data, root) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assign-btn";
    button.title = person.me ? t("assignMe") : t("assignTo", { name: person.displayName });
    button.appendChild(buildAvatar(person, 24));
    const label = document.createElement("span");
    label.className = "assign-name";
    label.textContent = person.me ? t("assignMe") : person.displayName;
    button.appendChild(label);
    button.addEventListener("click", () => assignAndFlash(person, data, button, root));
    return button;
  }

  // Zone « Gérer les personnes » : recherche + ajout (max 5) + retrait.
  function buildAssignManage(root, data) {
    const wrap = document.createElement("div");
    wrap.className = "assign-manage";

    // Liste courante avec retrait.
    const current = document.createElement("div");
    current.className = "assign-current";
    const renderCurrent = () => {
      current.innerHTML = "";
      settings.assignees.forEach((p) => {
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
          await saveAssignees(settings.assignees.filter((a) => a.accountId !== p.accountId));
          renderAssignSection(root, data);
        });
        chip.append(nm, rm);
        current.appendChild(chip);
      });
    };
    renderCurrent();
    wrap.appendChild(current);

    // Champ de recherche.
    const input = document.createElement("input");
    input.type = "text";
    input.className = "assign-search";
    input.placeholder = t("assignSearch");
    input.disabled = settings.assignees.length >= MAX_ASSIGNEES;
    wrap.appendChild(input);

    const results = document.createElement("div");
    results.className = "assign-results";
    wrap.appendChild(results);

    const note = document.createElement("div");
    note.className = "assign-note";
    if (settings.assignees.length >= MAX_ASSIGNEES) {
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
          users = await window.__jiraTicketHelper.searchUsers(q);
        } catch (_) {
          /* réseau : liste vide */
        }
        if (token !== searchToken || !results.isConnected) return;
        note.textContent = "";
        if (!users.length) {
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
          const already = settings.assignees.some((a) => a.accountId === u.accountId);
          if (already) {
            row.disabled = true;
            row.classList.add("in-list");
          }
          row.addEventListener("click", async () => {
            if (settings.assignees.length >= MAX_ASSIGNEES) {
              note.textContent = t("assignMax", { n: MAX_ASSIGNEES });
              return;
            }
            if (settings.assignees.some((a) => a.accountId === u.accountId)) {
              note.textContent = t("assignAlready");
              return;
            }
            await saveAssignees([
              ...settings.assignees,
              {
                accountId: u.accountId,
                displayName: u.displayName,
                avatarUrl: u.avatarUrl || "",
              },
            ]);
            renderAssignSection(root, data);
          });
          results.appendChild(row);
        }
      }, 300);
    });

    return wrap;
  }

  // Section « Assigner à » du panneau : boutons (personnes + moi) + zone de
  // gestion repliable. Reconstruite en place, sans rebâtir tout le panneau.
  async function renderAssignSection(root, data) {
    const container = root.querySelector("[data-assign]");
    if (!container) return;
    // `settings` peut avoir été réinitialisé par le listener de stockage
    // (déclenché par notre propre saveSettings lors d'un ajout/retrait) : on le
    // recharge au besoin pour que la section se redessine bien.
    if (!settings) await loadSettings();
    if (!container.isConnected) return;
    container.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = t("assignTitle");
    container.appendChild(heading);

    const list = document.createElement("div");
    list.className = "assign-list";
    list.appendChild(buildAssignPanelButton({ me: true, displayName: t("assignMe") }, data, root));
    settings.assignees.forEach((p) => {
      list.appendChild(buildAssignPanelButton(p, data, root));
    });
    container.appendChild(list);

    const toggle = document.createElement("a");
    toggle.href = "#";
    toggle.className = "assign-manage-toggle";
    toggle.textContent = (assignManageOpen ? "▾ " : "▸ ") + t("assignManage");
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      assignManageOpen = !assignManageOpen;
      renderAssignSection(root, data);
    });
    container.appendChild(toggle);

    if (assignManageOpen) container.appendChild(buildAssignManage(root, data));
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
        --muted: #5e6c84;
        --faint: #626f86;
        --border: #dfe1e6;
        --border-strong: #c1c7d0;
        --btn-bg: #ffffff;
        --btn-bg-hover: #f4f5f7;
        --ok: #216e4e;
        --ok-bg: #e6f5ef;
        --err: #c9372c;
        --warn: #974f0c;
        --warn-bg: #fff7d6;
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
          --muted: #9aa7b5;
          --faint: #8c99a8;
          --border: #38414a;
          --border-strong: #4c5560;
          --btn-bg: #22272b;
          --btn-bg-hover: #282e33;
          --ok: #7ee2b8;
          --ok-bg: #1c3329;
          --err: #fd9891;
          --warn: #f5cd47;
          --warn-bg: #332e1b;
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
      h1, h2 {
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
      .chip-type { border-color: #8fb8f6; }
      .chip-prio[data-value*="high"], .chip-prio[data-value*="haut"],
      .chip-prio[data-value*="élev"], .chip-prio[data-value*="critical"],
      .chip-prio[data-value*="block"] { border-color: #e5735f; }
      .chip-prio[data-value*="low"], .chip-prio[data-value*="bas"],
      .chip-prio[data-value*="minor"] { border-color: var(--ok); }
      .chip-status[data-value*="done"], .chip-status[data-value*="terminé"],
      .chip-status[data-value*="closed"], .chip-status[data-value*="résolu"] {
        border-color: var(--ok); color: var(--ok);
      }
      .chip-status[data-value*="progress"], .chip-status[data-value*="cours"] {
        border-color: var(--blue); color: var(--blue);
      }
      .badge {
        display: inline-block;
        margin-left: 6px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .04em;
        color: var(--blue-dark);
        background: var(--blue-tint);
        border-radius: 999px;
        padding: 0 6px;
        vertical-align: middle;
      }
      /* Sections repliables (Multi-tickets, Récents) — alignées sur le popup. */
      details.section {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
      }
      details.section > summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        color: var(--faint);
        text-transform: uppercase;
        letter-spacing: .07em;
      }
      details.section > summary::-webkit-details-marker { display: none; }
      details.section > summary::before { content: "\\25B8"; font-size: 9px; }
      details.section[open] > summary::before { content: "\\25BE"; }
      details.section > summary:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .sec-count {
        margin-left: auto;
        font-weight: 600;
        color: var(--muted);
        text-transform: none;
        letter-spacing: 0;
      }
      .sec-actions { display: flex; justify-content: flex-end; margin: 6px 0 2px; }
      .sec-actions a { color: var(--faint); font-size: 12px; text-decoration: none; }
      .sec-actions a:hover { color: var(--blue); text-decoration: underline; }
      .multi-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 4px 0 8px;
        max-height: 180px;
        overflow: auto;
      }
      .multi-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 3px 4px;
        border-radius: 6px;
        cursor: pointer;
      }
      .multi-row:hover { background: var(--bg-sunken); }
      .multi-row input { flex: 0 0 auto; align-self: center; }
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
      .ico svg { display: block; }
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
      .foot-hint { margin-top: 6px; font-size: 11px; color: var(--faint); }
      .foot kbd {
        font-family: var(--mono);
        font-size: 10px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 0 4px;
      }
      .hist-item .body {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .hist-key {
        font-weight: 700;
        color: var(--blue);
        font-family: var(--mono);
        flex: 0 0 auto;
      }
      .hist-title {
        color: var(--muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .assign:not(:empty) {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
      }
      .assign-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .assign-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: 100%;
        border: 1px solid var(--border);
        background: var(--btn-bg);
        color: var(--fg);
        border-radius: 999px;
        padding: 4px 11px 4px 4px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        transition: background .12s, border-color .12s, box-shadow .12s;
      }
      .assign-btn:hover {
        background: var(--btn-bg-hover);
        border-color: var(--border-strong);
        box-shadow: var(--shadow);
      }
      .assign-btn:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 1px;
      }
      .assign-btn.done {
        border-color: var(--ok);
        background: var(--ok-bg);
        color: var(--ok);
      }
      .assign-btn.confirm {
        border-color: var(--warn);
        background: var(--warn-bg);
        color: var(--warn);
        font-weight: 600;
      }
      .assign-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .assign-manage-toggle {
        display: inline-block;
        margin-top: 10px;
        color: var(--faint);
        font-size: 12px;
        text-decoration: none;
      }
      .assign-manage-toggle:hover { color: var(--blue); text-decoration: underline; }
      .assign-manage {
        margin-top: 8px;
      }
      .assign-current {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .assign-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 2px 4px 2px 4px;
        font-size: 12px;
      }
      .assign-chip-name { color: var(--fg); }
      .assign-chip-rm {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--faint);
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 0 2px;
      }
      .assign-chip-rm:hover { color: var(--err); }
      .assign-search {
        width: 100%;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 6px 9px;
        font: inherit;
        font-size: 13px;
      }
      .assign-search:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
      .assign-search:disabled { opacity: .55; cursor: not-allowed; }
      .assign-results {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 6px;
        max-height: 180px;
        overflow: auto;
      }
      .assign-result {
        appearance: none;
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        background: transparent;
        color: var(--fg);
        border-radius: 6px;
        padding: 4px 6px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .assign-result:hover { background: var(--bg-sunken); border-color: var(--border); }
      .assign-result.in-list { opacity: .5; cursor: default; }
      .assign-note {
        margin-top: 6px;
        min-height: 14px;
        font-size: 12px;
        color: var(--muted);
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
    pane.setAttribute("aria-label", t("paneAria"));

    const bar = document.createElement("div");
    bar.className = "pane-bar";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.title = t("close");
    close.setAttribute("aria-label", t("closePane"));
    close.textContent = "x";
    close.addEventListener("click", () => {
      removePane();
      scheduleRefresh();
    });

    bar.appendChild(close);

    const body = document.createElement("div");
    body.className = "pane-body";

    const heading = document.createElement("h1");
    heading.textContent = t("paneTitle");

    body.appendChild(heading);
    body.appendChild(buildTicketHead(data));

    const buttons = document.createElement("div");
    buttons.className = "btns";
    const preferredId = preferredFormat().id;
    settings.formats.forEach((format) => {
      buttons.appendChild(buildCopyButton(format, data, format.id === preferredId, root));
    });
    body.appendChild(buttons);

    const assign = document.createElement("div");
    assign.className = "assign";
    assign.dataset.assign = "";
    body.appendChild(assign);

    const foot = document.createElement("div");
    foot.className = "foot";
    const options = document.createElement("a");
    options.href = "#";
    options.textContent = t("customize");
    options.addEventListener("click", (event) => {
      event.preventDefault();
      // `chrome.runtime.openOptionsPage()` n'existe pas dans un content script :
      // on délègue au service worker via un message.
      chrome.runtime.sendMessage({ type: "open-options" });
    });
    foot.appendChild(options);

    // Rappel des raccourcis du panneau (basculer / fermer) — découvrabilité.
    const hint = document.createElement("div");
    hint.className = "foot-hint";
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    const kbToggle = document.createElement("kbd");
    kbToggle.textContent = isMac ? "⌘⇧Y" : "Ctrl+Shift+Y";
    hint.append(kbToggle, document.createTextNode(" " + t("paneToggleHint") + " · "));
    const kbEsc = document.createElement("kbd");
    kbEsc.textContent = t("keyEsc");
    hint.append(kbEsc, document.createTextNode(" " + t("paneCloseHint")));
    foot.appendChild(hint);

    body.appendChild(foot);

    const status = document.createElement("div");
    status.className = "status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.dataset.status = "";
    body.appendChild(status);

    const multi = document.createElement("div");
    multi.className = "multi";
    multi.dataset.multi = "";
    body.appendChild(multi);

    const history = document.createElement("div");
    history.className = "history";
    history.dataset.history = "";
    body.appendChild(history);

    pane.append(bar, body);
    root.append(style, pane);

    // Section d'auto-assignation (personnes configurées + « M'assigner »).
    renderAssignSection(root, data);

    // Sections optionnelles (multi-tickets + historique), comme dans le popup.
    renderMultiSection(root);
    renderHistorySection(root);

    paneContentSig = paneSignature(data);
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

    // Réouverture du panneau après un rechargement déclenché par une assignation.
    if (pendingReopenKey && pendingReopenKey === data.key && !paneOpen) {
      paneOpen = true;
      pendingReopenKey = null;
    }

    const signature = getSignature(data);
    const signatureChanged = signature !== activeSignature;
    if (signatureChanged) {
      activeSignature = signature;
      // Nouveau ticket : on réinitialise le cache d'enrichissement + l'assigné
      // en attente (spécifique à l'ancien ticket).
      enrichedKey = null;
      enrichedData = null;
      pendingAssignee = null;
      removePane();
    }

    // Données affichées : version enrichie (API) si disponible pour cette clé,
    // puis surchargée par un assigné fraîchement posé (retour immédiat).
    const base = enrichedData && enrichedData.key === data.key ? enrichedData : data;
    const view = applyPendingAssignee(base);

    const buttonReady = renderActionButton(view);
    if (paneOpen) {
      ensureEnriched(data);
      // Ne reconstruit le panneau que si son contenu (ticket) a changé, pour
      // préserver l'état interne malgré les mutations fréquentes de la page.
      if (paneSignature(view) !== paneContentSig) renderPane(view);
    }

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

  // Bascule le panneau depuis le raccourci clavier (relayé par le background).
  // Reprend la logique de refresh() : mêmes garde-fous, même vue enrichie.
  async function togglePane() {
    if (!likelyJiraPage()) return;
    if (!settings) await loadSettings();
    const data = getTicketData();
    if (!data) return;

    paneOpen = !paneOpen;
    if (!paneOpen) {
      removePane();
      scheduleRefresh();
      return;
    }

    const base = enrichedData && enrichedData.key === data.key ? enrichedData : data;
    const view = applyPendingAssignee(base);
    ensureEnriched(data);
    renderActionButton(view);
    renderPane(view);
    scheduleRefresh();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "toggle-pane") {
      togglePane();
      return;
    }
    // Relais de recherche de personnes pour la page d'options (qui n'a pas la
    // session Jira) : le service worker nous transmet la requête, on interroge
    // l'API depuis la page puis on renvoie les résultats.
    if (msg.type === "search-users") {
      window.__jiraTicketHelper
        .searchUsers(msg.query)
        .then((results) => sendResponse({ ok: true, results }))
        .catch(() => sendResponse({ ok: false, results: [] }));
      return true; // réponse asynchrone
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRefresh, { once: true });
  } else {
    scheduleRefresh();
  }
})();
