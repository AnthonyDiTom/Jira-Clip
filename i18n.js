// i18n.js — internationalisation légère (fr/en) sans dépendance.
// UMD : s'expose sur self.JiraI18n en navigateur/worker, module.exports en Node.
//
// Utilisation : JiraI18n.setLang("auto"|"fr"|"en"), puis JiraI18n.t("clé", vars).
// Les variables {x} dans les chaînes sont remplacées depuis `vars`.
(function (root, factory) {
  const api = factory();
  root.JiraI18n = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MESSAGES = {
    fr: {
      paneTitle: "Ticket Jira",
      detecting: "Détection en cours…",
      noTitle: "(titre introuvable)",
      noTicket: "Aucun ticket Jira détecté sur cette page.",
      noTab: "Onglet introuvable.",
      noAccess: "Impossible d'accéder à cette page (page interne du navigateur ?).",
      buildFailed: "Impossible de construire ce ticket.",
      loading: "Chargement…",
      invalidKey: "Clé invalide (attendu : LETTRES-CHIFFRES).",
      manualPlaceholder: "Saisir une clé, ex. DEMO-1234",
      load: "Charger",
      copied: "Copié : {text}",
      copiedShort: "✓ Copié",
      copyFailed: "Échec de la copie",
      copy: "Copier",
      copyN: "{n} · Copier",
      last: "dernier",
      customize: "⚙︎ Personnaliser les formats",
      type: "Type",
      status: "Statut",
      assignee: "Assigné",
      priority: "Priorité",
      ticketsOnPage: "{n} tickets sur cette page",
      checkAll: "Tout cocher",
      uncheckAll: "Tout décocher",
      copySelection: "Copier la sélection",
      checklistMd: "Checklist Markdown",
      noneSelected: "Aucun ticket sélectionné.",
      recent: "Récents",
      clear: "Effacer",
      close: "Fermer",
      closePane: "Fermer le panneau de copie",
      paneAria: "Copies Jira",
      openCopies: "Ouvrir les copies Jira ({key})",
      openCopiesAria: "Ouvrir les copies Jira pour {key}",
      menuRoot: "Ticket Jira",
      menuCopy: "Copier : {label}",
      assignTitle: "Assigner à",
      assignManage: "Gérer les personnes",
      assignSearch: "Rechercher une personne…",
      assignMe: "M'assigner",
      assignMeShort: "Moi",
      assigning: "Assignation…",
      assigned: "✓ Assigné à {name}",
      assignedShort: "✓ Assigné",
      assignFailed: "Échec de l'assignation",
      assignTo: "Assigner à {name}",
      assignRemove: "Retirer",
      assignAdd: "Ajouter",
      assignMax: "Maximum {n} personnes.",
      assignNoResult: "Aucune personne trouvée.",
      assignSearching: "Recherche…",
      assignEmpty: "Aucune personne configurée. Utilisez « Gérer » pour en ajouter.",
      assignOpenJira: "Ouvrez un onglet Jira pour rechercher des personnes.",
      assignAlready: "Déjà dans la liste.",
      assignEmptyPopup: "Aucune personne. Utilisez « Gérer les personnes » ci-dessous.",
      shortcutsHelp: "1–9 : copier · Entrée : dernier format",
      confirmAssignArm: "Confirmer ?",
      confirmAssignHint: "Cliquez à nouveau — l'onglet Jira sera rechargé.",
      confirmAssignArmToast:
        "{key} → {name} ? Cliquez encore pour confirmer (l'onglet sera rechargé).",
      footPaneShortcut: "Panneau sur une page Jira",
      paneToggleHint: "basculer le panneau",
      paneCloseHint: "fermer",
      keyEsc: "Échap",
      emptyHint: "Ouvrez un ticket Jira, ou saisissez sa clé ci-dessous.",
      // --- Page d'options ---
      optTitle: "Options — Jira Ticket Copier",
      optHeading: "Jira Ticket Copier — Options",
      optIntro:
        "Personnalise les formats de copie. Chaque format est un gabarit texte où les variables ci-dessous sont remplacées par les données du ticket.",
      optVarsHint:
        "Cliquez sur une variable pour l'insérer dans le gabarit sélectionné. Aperçu calculé sur un ticket d'exemple. <code>{branch}</code> et <code>{commitType}</code> dépendent du type d'issue (voir Réglages avancés) ; <code>{date}</code> est la date du jour (AAAA-MM-JJ). Ajoutez <code>:N</code> pour tronquer, ex. <code>{slug:40}</code> ou <code>{title:60}</code>. <code>{parentKey}</code> nécessite l'accès à l'API Jira (rempli au mieux).",
      optSectionFormats: "Personnalisation des formats",
      optSectionOptions: "Options",
      optAddFormat: "+ Ajouter un format",
      optSave: "Enregistrer",
      optReset: "Réinitialiser les défauts",
      optExport: "⭳ Exporter (JSON)",
      optImport: "⭱ Importer (JSON)",
      optMultiTitle: "Copie multi-tickets",
      optMultiSub: "Gabarit appliqué à chaque ligne dans les vues board / backlog.",
      optAssignTitle: "Auto-assignation",
      optAssignSub:
        "Choisissez jusqu'à <strong>5 personnes</strong> : un bouton d'assignation rapide est créé pour chacune (dans le panneau latéral et dans la barre d'actions du ticket), en plus du bouton « M'assigner ». La recherche interroge votre Jira : <strong>gardez un onglet Jira ouvert</strong> pour qu'elle fonctionne depuis cette page.",
      optAssignSearchPh: "Rechercher une personne (nom ou e-mail)…",
      optInstancesTitle: "Instances Jira supplémentaires",
      optInstancesSub:
        "Le bouton dans la page s'affiche automatiquement sur <code>*.atlassian.net</code>. Pour une instance auto-hébergée ou un domaine personnalisé, ajoutez son adresse : le navigateur demandera l'autorisation d'accès à ce site. La popup, le raccourci et le menu contextuel fonctionnent partout sans ajout.",
      optOriginPh: "https://jira.mon-entreprise.com",
      optOriginAdd: "Ajouter",
      optAdvSummary: "Réglages avancés",
      optBackupTitle: "Sauvegarde et réinitialisation",
      optBackupSub:
        "Exportez ou importez l'ensemble de vos réglages (formats compris), ou revenez aux valeurs par défaut.",
      optAdvSub:
        "Associez une sous-chaîne du type d'issue (insensible à la casse) à une valeur ; <code>default</code> sert de repli.",
      optBranchLabel: "Préfixes de branche → <code>{branchPrefix}</code> / <code>{branch}</code>",
      optCommitLabel: "Types de commit → <code>{commitType}</code>",
      optCleanupLabel:
        "Nettoyage du titre — motifs retirés (<code>{title}</code>, <code>{slug}</code>, <code>{branch}</code>…)",
      optStripTags: "Ignorer les tags entre crochets (<code>[FRONT]</code>, <code>[BE]</code>…)",
      optCleanupSub:
        "Motifs supplémentaires (expression régulière), un par ligne, retirés du titre avant de générer les formats. Ex. <code>/^\\s*wip:?/i</code> retire un préfixe « WIP: ». La casse est ignorée par défaut. <code>{titleRaw}</code> conserve le titre d'origine.",
      optHistoryLabel: "Nombre de tickets gardés dans l'historique",
      optLangLabel: "Langue de la popup et du panneau",
      optLangAuto: "Automatique (navigateur)",
      optLangFr: "Français",
      optLangEn: "English",
      optKeyPh: "type d'issue (ex. bug)",
      optValuePh: "valeur",
      optAddRow: "+ Ajouter une correspondance",
      optColKey: "Sous-chaîne du type",
      optColVal: "Valeur",
      optDefaultRow: "défaut",
      optInsertVar: "Insérer {v} dans le gabarit sélectionné",
      optLibelle: "Libellé",
      optGabarit: "Gabarit",
      optPreviewText: "Texte copié",
      optPreviewRendered: "Rendu (éditeur riche)",
      optUp: "Monter",
      optDown: "Descendre",
      optDelete: "Supprimer",
      optRemove: "Retirer",
      optNewFormat: "Nouveau format",
      optSaved: "✓ Enregistré",
      optResetDone: "✓ Défauts restaurés",
      optExported: "✓ Exporté",
      optImported: "✓ Importé",
      optUnsaved: "● Modifications non enregistrées",
      optNeedFormat: "Au moins un format (libellé + gabarit) est requis.",
      optOriginInvalid: "Adresse invalide.",
      optOriginDup: "Cette instance est déjà dans la liste.",
      optPermDenied: "Permission refusée : {msg}",
      optPermRefused: "Autorisation d'accès au site refusée.",
      optSearching: "Recherche…",
      optSearchUnavail: "Recherche indisponible.",
      optOpenJiraTab: "Ouvrez un onglet Jira pour rechercher des personnes.",
      optNoPerson: "Aucune personne trouvée.",
      optMaxPeople: "Maximum {n} personnes.",
      optAlready: "Déjà dans la liste.",
      optInvalidPatterns: "Motifs invalides ignorés",
      optInvalidPattern: "Motif invalide ignoré",
      optLine: "ligne {line} ({pattern})",
      optImportFail: "Import impossible : {msg}",
      confirmReset:
        "Réinitialiser tous les formats et réglages aux valeurs par défaut ? Cette action est irréversible.",
    },
    en: {
      paneTitle: "Jira ticket",
      detecting: "Detecting…",
      noTitle: "(title not found)",
      noTicket: "No Jira ticket detected on this page.",
      noTab: "Tab not found.",
      noAccess: "Can't access this page (browser-internal page?).",
      buildFailed: "Couldn't build this ticket.",
      loading: "Loading…",
      invalidKey: "Invalid key (expected LETTERS-DIGITS).",
      manualPlaceholder: "Enter a key, e.g. DEMO-1234",
      load: "Load",
      copied: "Copied: {text}",
      copiedShort: "✓ Copied",
      copyFailed: "Copy failed",
      copy: "Copy",
      copyN: "{n} · Copy",
      last: "last",
      customize: "⚙︎ Customize formats",
      type: "Type",
      status: "Status",
      assignee: "Assignee",
      priority: "Priority",
      ticketsOnPage: "{n} tickets on this page",
      checkAll: "Select all",
      uncheckAll: "Deselect all",
      copySelection: "Copy selection",
      checklistMd: "Markdown checklist",
      noneSelected: "No ticket selected.",
      recent: "Recent",
      clear: "Clear",
      close: "Close",
      closePane: "Close the copy panel",
      paneAria: "Jira copies",
      openCopies: "Open Jira copies ({key})",
      openCopiesAria: "Open Jira copies for {key}",
      menuRoot: "Jira ticket",
      menuCopy: "Copy: {label}",
      assignTitle: "Assign to",
      assignManage: "Manage people",
      assignSearch: "Search for a person…",
      assignMe: "Assign to me",
      assignMeShort: "Me",
      assigning: "Assigning…",
      assigned: "✓ Assigned to {name}",
      assignedShort: "✓ Assigned",
      assignFailed: "Assignment failed",
      assignTo: "Assign to {name}",
      assignRemove: "Remove",
      assignAdd: "Add",
      assignMax: "At most {n} people.",
      assignNoResult: "No person found.",
      assignSearching: "Searching…",
      assignEmpty: "No people configured yet. Use “Manage” to add some.",
      assignOpenJira: "Open a Jira tab to search for people.",
      assignAlready: "Already in the list.",
      assignEmptyPopup: "No people yet. Use “Manage people” below.",
      shortcutsHelp: "1–9: copy · Enter: last format",
      confirmAssignArm: "Confirm?",
      confirmAssignHint: "Click again — the Jira tab will reload.",
      confirmAssignArmToast:
        "{key} → {name}? Click again to confirm (the tab will reload).",
      footPaneShortcut: "Panel on a Jira page",
      paneToggleHint: "toggle the panel",
      paneCloseHint: "close",
      keyEsc: "Esc",
      emptyHint: "Open a Jira ticket, or enter its key below.",
      // --- Options page ---
      optTitle: "Options — Jira Ticket Copier",
      optHeading: "Jira Ticket Copier — Options",
      optIntro:
        "Customize the copy formats. Each format is a text template where the variables below are replaced with the ticket's data.",
      optVarsHint:
        "Click a variable to insert it into the selected template. Preview computed on a sample ticket. <code>{branch}</code> and <code>{commitType}</code> depend on the issue type (see Advanced settings); <code>{date}</code> is today's date (YYYY-MM-DD). Add <code>:N</code> to truncate, e.g. <code>{slug:40}</code> or <code>{title:60}</code>. <code>{parentKey}</code> needs Jira API access (filled best-effort).",
      optSectionFormats: "Format customization",
      optSectionOptions: "Options",
      optAddFormat: "+ Add a format",
      optSave: "Save",
      optReset: "Reset to defaults",
      optExport: "⭳ Export (JSON)",
      optImport: "⭱ Import (JSON)",
      optMultiTitle: "Multi-ticket copy",
      optMultiSub: "Template applied to each line in board / backlog views.",
      optAssignTitle: "Auto-assign",
      optAssignSub:
        "Pick up to <strong>5 people</strong>: a quick-assign button is created for each (in the side panel and in the ticket action bar), plus an “Assign to me” button. Search queries your Jira: <strong>keep a Jira tab open</strong> for it to work from this page.",
      optAssignSearchPh: "Search for a person (name or email)…",
      optInstancesTitle: "Additional Jira instances",
      optInstancesSub:
        "The in-page button shows automatically on <code>*.atlassian.net</code>. For a self-hosted instance or a custom domain, add its address: the browser will ask for access permission. The popup, shortcut and context menu work everywhere without adding anything.",
      optOriginPh: "https://jira.my-company.com",
      optOriginAdd: "Add",
      optAdvSummary: "Advanced settings",
      optBackupTitle: "Backup & reset",
      optBackupSub:
        "Export or import all your settings (formats included), or restore the defaults.",
      optAdvSub:
        "Map a substring of the issue type (case-insensitive) to a value; <code>default</code> is the fallback.",
      optBranchLabel: "Branch prefixes → <code>{branchPrefix}</code> / <code>{branch}</code>",
      optCommitLabel: "Commit types → <code>{commitType}</code>",
      optCleanupLabel:
        "Title cleanup — patterns removed (<code>{title}</code>, <code>{slug}</code>, <code>{branch}</code>…)",
      optStripTags: "Ignore bracketed tags (<code>[FRONT]</code>, <code>[BE]</code>…)",
      optCleanupSub:
        "Extra patterns (regular expression), one per line, removed from the title before generating formats. E.g. <code>/^\\s*wip:?/i</code> removes a “WIP:” prefix. Case-insensitive by default. <code>{titleRaw}</code> keeps the original title.",
      optHistoryLabel: "Number of tickets kept in history",
      optLangLabel: "Popup and panel language",
      optLangAuto: "Automatic (browser)",
      optLangFr: "Français",
      optLangEn: "English",
      optKeyPh: "issue type (e.g. bug)",
      optValuePh: "value",
      optAddRow: "+ Add a mapping",
      optColKey: "Type substring",
      optColVal: "Value",
      optDefaultRow: "default",
      optInsertVar: "Insert {v} into the selected template",
      optLibelle: "Label",
      optGabarit: "Template",
      optPreviewText: "Copied text",
      optPreviewRendered: "Rendered (rich editor)",
      optUp: "Move up",
      optDown: "Move down",
      optDelete: "Delete",
      optRemove: "Remove",
      optNewFormat: "New format",
      optSaved: "✓ Saved",
      optResetDone: "✓ Defaults restored",
      optExported: "✓ Exported",
      optImported: "✓ Imported",
      optUnsaved: "● Unsaved changes",
      optNeedFormat: "At least one format (label + template) is required.",
      optOriginInvalid: "Invalid address.",
      optOriginDup: "This instance is already in the list.",
      optPermDenied: "Permission denied: {msg}",
      optPermRefused: "Site access permission denied.",
      optSearching: "Searching…",
      optSearchUnavail: "Search unavailable.",
      optOpenJiraTab: "Open a Jira tab to search for people.",
      optNoPerson: "No person found.",
      optMaxPeople: "At most {n} people.",
      optAlready: "Already in the list.",
      optInvalidPatterns: "Invalid patterns ignored",
      optInvalidPattern: "Invalid pattern ignored",
      optLine: "line {line} ({pattern})",
      optImportFail: "Import failed: {msg}",
      confirmReset:
        "Reset all formats and settings to their defaults? This cannot be undone.",
    },
  };

  let lang = "fr";

  function detect() {
    const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
    return /^fr/i.test(nav) ? "fr" : "en";
  }

  // "auto" : suit la langue du navigateur ; sinon force fr/en.
  function setLang(value) {
    lang = value === "en" ? "en" : value === "fr" ? "fr" : detect();
    return lang;
  }

  function getLang() {
    return lang;
  }

  function t(key, vars) {
    const table = MESSAGES[lang] || MESSAGES.fr;
    let s = table[key];
    if (s == null) s = (MESSAGES.fr[key] != null ? MESSAGES.fr[key] : key);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole
      );
    }
    return s;
  }

  return { MESSAGES, setLang, getLang, detect, t };
});
