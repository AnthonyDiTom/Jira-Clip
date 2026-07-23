// extract-fn.js
// Extraction du ticket Jira depuis le DOM/URL + copie presse-papier + toast.
// La logique *pure* de parsing du DOM vit dans extract-core.js
// (self.JiraExtract) et les transformations de texte / gabarits dans
// template-engine.js (self.JiraTemplate) : les deux restent testables hors
// navigateur (voir test/).
//
// Ce fichier est injecté dans la page (isolated world) via chrome.scripting et
// chargé aussi dans la popup. Il n'ajoute plus que la partie « impérative »
// (accès aux globales document/location, réseau, presse-papier, toast) et
// s'expose via window.__jiraTicketHelper.
(function () {
  if (window.__jiraTicketHelper) return;

  const T = self.JiraTemplate;
  const X = self.JiraExtract;

  // Ponts vers la logique pure : on lui passe le document et la location de la
  // page courante. Le parsing lui-même ne touche jamais aux globales.
  const extract = () => X.extract(document, location);
  const extractFor = (key) => X.extractFor(document, location, key);
  const extractMultiple = () => X.extractMultiple(document, location);

  // ---- Repli / enrichissement via l'API REST Jira -------------------------
  // Complète les champs manquants (titre, type, statut, assigné, priorité,
  // parent) via l'API REST, en réutilisant la session (cookies) de l'onglet.
  // Best-effort : toute erreur renvoie les données inchangées.
  async function enrichViaApi(data, opts) {
    if (!data || !data.key) return data;
    const needsCore = !data.title || !data.type || !data.status;
    // Le parent n'est lisible que via l'API : on ne le récupère que si un
    // gabarit l'utilise réellement (opts.wantParent), pour éviter un appel
    // réseau à chaque ouverture quand {parentKey} n'est pas employé.
    const needsParent = opts && opts.wantParent && !data.parentKey;
    if (!needsCore && !needsParent) return data;

    const fields = "summary,issuetype,status,assignee,priority,parent,project";
    const paths = [
      `/rest/api/3/issue/${encodeURIComponent(data.key)}?fields=${fields}`,
      `/rest/api/2/issue/${encodeURIComponent(data.key)}?fields=${fields}`,
    ];
    for (const path of paths) {
      try {
        const res = await fetch(location.origin + path, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const f = (json && json.fields) || {};
        return {
          ...data,
          title: data.title || (f.summary || "").trim(),
          type: data.type || (f.issuetype && f.issuetype.name) || "",
          status: data.status || (f.status && f.status.name) || "",
          assignee:
            data.assignee ||
            (f.assignee && (f.assignee.displayName || f.assignee.name)) ||
            "",
          priority: data.priority || (f.priority && f.priority.name) || "",
          parentKey: data.parentKey || (f.parent && f.parent.key) || "",
          project:
            data.project || (f.project && f.project.key) || T.projectFromKey(data.key),
        };
      } catch (_) {
        /* endpoint indisponible : on tente le suivant / on abandonne */
      }
    }
    return data;
  }

  // ---- Auto-assignation (API REST Jira, session de l'onglet) --------------
  // Toutes ces requêtes sont *same-origin* (location.origin) : le cookie de
  // session est envoyé via `credentials: "include"`, sans permission hôte
  // supplémentaire (même mécanisme que enrichViaApi).

  // Avatar « raisonnable » depuis l'objet avatarUrls de Jira (24 ou 32 px).
  function pickAvatar(avatarUrls) {
    if (!avatarUrls || typeof avatarUrls !== "object") return "";
    return avatarUrls["24x24"] || avatarUrls["32x32"] || avatarUrls["48x48"] || "";
  }

  // Recherche de personnes par nom / e-mail. Renvoie une liste normalisée
  // [{ accountId, displayName, avatarUrl }]. Best-effort : [] en cas d'échec.
  async function searchUsers(query) {
    const q = (query || "").trim();
    if (!q) return [];
    const enc = encodeURIComponent(q);
    const paths = [
      `/rest/api/3/user/search?query=${enc}&maxResults=10`,
      `/rest/api/2/user/search?username=${enc}&maxResults=10`,
    ];
    for (const path of paths) {
      try {
        const res = await fetch(location.origin + path, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (!Array.isArray(json)) continue;
        return json
          .map((u) => ({
            accountId: u.accountId || u.name || "",
            displayName: u.displayName || u.name || "",
            avatarUrl: pickAvatar(u.avatarUrls),
          }))
          .filter((u) => u.accountId && u.displayName);
      } catch (_) {
        /* endpoint indisponible : on tente le suivant / on abandonne */
      }
    }
    return [];
  }

  // Utilisateur courant (pour « M'assigner »). Renvoie
  // { accountId, displayName, avatarUrl } ou null.
  async function getMyself() {
    const paths = ["/rest/api/3/myself", "/rest/api/2/myself"];
    for (const path of paths) {
      try {
        const res = await fetch(location.origin + path, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;
        const u = await res.json();
        const accountId = u.accountId || u.name || "";
        if (!accountId) continue;
        return {
          accountId,
          displayName: u.displayName || u.name || "",
          avatarUrl: pickAvatar(u.avatarUrls),
        };
      } catch (_) {
        /* on tente le suivant */
      }
    }
    return null;
  }

  // Assigne le ticket `key` à `accountId` (null = désassigné). Renvoie
  // { ok, status, error? }. On tente l'API v3 puis v2. Le header
  // X-Atlassian-Token contourne la protection anti-XSRF quand la session est
  // basée sur les cookies.
  async function assignIssue(key, accountId) {
    if (!key) return { ok: false, error: "no-key" };
    const attempts = [
      { path: `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, body: { accountId } },
      { path: `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`, body: { accountId } },
      // Jira Server / DC historique : champ « name » plutôt qu'« accountId ».
      { path: `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`, body: { name: accountId } },
    ];
    let lastStatus = 0;
    for (const a of attempts) {
      try {
        const res = await fetch(location.origin + a.path, {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Atlassian-Token": "no-check",
          },
          body: JSON.stringify(a.body),
        });
        lastStatus = res.status;
        // 204 = succès (Jira ne renvoie pas de corps sur l'assignation).
        if (res.ok) return { ok: true, status: res.status };
        // 400/404 : mauvais schéma pour cette version → on tente le repli.
        if (res.status !== 400 && res.status !== 404) {
          return { ok: false, status: res.status };
        }
      } catch (_) {
        /* endpoint indisponible : repli */
      }
    }
    return { ok: false, status: lastStatus };
  }

  // ---- Copie presse-papier -------------------------------------------------
  // Copie `text`, et optionnellement une version `html` (presse-papier riche :
  // liens cliquables dans les éditeurs qui le supportent).
  async function copyText(text, options) {
    const html = options && options.html;
    try {
      if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const item = new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Repli si l'API Clipboard est indisponible (page non focalisée, etc.)
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // Copie « intelligente » : si le texte ressemble à du Markdown, on joint une
  // version HTML pour coller un lien cliquable dans les éditeurs riches.
  async function copySmart(text) {
    const html = T.looksLikeMarkdown(text) ? T.markdownToHtml(text) : null;
    return copyText(text, html ? { html } : undefined);
  }

  // ---- Petit toast dans la page (raccourci / menu contextuel) --------------
  function toast(message, isError) {
    const id = "__jira-ticket-toast";
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
      background: isError ? "#c9372c" : "#1868db",
      boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      transition: "opacity .3s",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  // Extraction + enrichissement API + rendu + copie + toast, en un appel
  // (raccourci clavier / menu contextuel). `lang` = langue d'interface choisie.
  async function extractAndCopy(template, opts, lang) {
    const I = self.JiraI18n;
    if (I && lang) I.setLang(lang);
    const tr = (k, v) => (I ? I.t(k, v) : k);

    let data = extract();
    if (!data.ok) {
      toast(tr("noTicket"), true);
      return data;
    }
    data = await enrichViaApi(data, { wantParent: /\{parentKey\}/.test(template) });
    const text = T.renderTemplate(template, data, opts);
    const copied = await copySmart(text);
    toast(copied ? tr("copied", { text }) : tr("copyFailed"), !copied);
    return { ok: copied, text, key: data.key, title: data.title, url: data.url };
  }

  window.__jiraTicketHelper = {
    extract,
    extractFor,
    extractMultiple,
    enrichViaApi,
    searchUsers,
    getMyself,
    assignIssue,
    // Ré-exports de la logique pure (compat : appelants existants inchangés).
    renderTemplate: T.renderTemplate,
    renderMultiple: T.renderMultiple,
    slugify: T.slugify,
    markdownToHtml: T.markdownToHtml,
    looksLikeMarkdown: T.looksLikeMarkdown,
    copyText,
    copySmart,
    extractAndCopy,
  };
})();
