# Jira Ticket Copier

Chrome extension (Manifest V3) that grabs the **key** and **title** of a Jira ticket
and copies them to the clipboard, in **customizable** formats.

Example for a ticket:
`DEMO-1234 Feature demo - Improve ticket copy examples`

> Works on any Jira instance — Chromium-based browsers (Chrome, Edge, Brave, …).

## Features

Four ways to trigger a copy:

| Trigger                       | Behavior                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| **Button in Jira**            | Button near the ticket actions, side panel with the popup interface (`Cmd/Ctrl+Shift+Y` to open/close, `Esc` to close) |
| **Click the icon**            | Popup: detected ticket, copy buttons, history, multi (keys `1`–`9` = copy the matching format, `Enter` = last used format) |
| **Keyboard shortcut**         | `Cmd/Ctrl+Shift+U` — "Key + title" (plus branch / markdown shortcuts) |
| **Right-click → Jira Ticket** | Submenu with every format                                    |

### Copy formats (customizable)

Formats provided by default:

- **Key + title** — `DEMO-1234 Feature demo - …`
- **Git branch name** — `feature/DEMO-1234-feature-demo-…`
  (prefix chosen from the **issue type**, key preserved, title in kebab-case)
- **Git switch command** — `git switch -c feature/DEMO-1234-…` (ready to paste)
- **Commit message** — `feat(DEMO-1234): Feature demo - …` (Conventional Commits type inferred from the issue type)
- **Markdown link** — `[DEMO-1234](https://…/browse/DEMO-1234) Feature demo - …`
- **Key only** — `DEMO-1234`
- **PR description** — pre-filled Markdown skeleton (link, context, changes, tests)

Each format is a **template** you can edit on the options page, with these variables:

`{key}` `{title}` `{titleRaw}` (uncleaned title) `{titleMd}` (Markdown-escaped)
`{titleLower}` `{slug}` `{url}`
`{type}` `{status}` `{assignee}` `{priority}` `{project}` `{parentKey}`
`{commitType}` `{branchPrefix}` `{branch}` (= prefix + key + slug) `{date}` (today's date, YYYY-MM-DD)

Append `:N` to a variable to truncate it, e.g. `{slug:40}` or `{title:60}`.

`{project}` is derived from the key (`DEMO-1234` → `DEMO`). `{parentKey}` (parent
ticket / epic) is filled best-effort through Jira's REST API.

On the options page, click a variable to insert it directly into the selected
template.

Each format shows a **live preview** computed on a sample ticket: the **copied
text** (raw) and, for Markdown templates, the **rendered output** as it will be
pasted into a rich editor (Slack, Confluence…).

`{commitType}` and `{branchPrefix}` are derived from the issue type through
editable mappings (e.g. `bug → fix` / `bugfix/`).

#### Title cleanup

In the **advanced settings**, the title can be cleaned before the formats
(slug / branch / commit) are generated:

- **"Ignore bracketed tags"** checkbox: automatically strips `[FRONT]`, `[BE]`…
  without writing a pattern.
- Extra list of **patterns** (regular expressions, one per line),
  e.g. `/^\s*wip:?/i` strips a "WIP:" prefix.

Case is ignored by default; the `/pattern/flags` form lets you set the flags.
Cleanup applies to `{title}`, `{slug}`, `{branch}`… ; `{titleRaw}` always keeps
the original title.

### Auto-assign

Assign a ticket in one click to people you choose (**5 maximum**), on top of a
**"Assign to me"** button.

- Each configured person becomes a **quick-assign button**, both in the **side
  panel** ("Assign to" section) and in the ticket's **action bar** (small avatars
  next to the ⧉ button).
- **Choosing people**: search by name / email, either from the "Manage people"
  area of the panel (directly on a Jira page), or from the **options** page. From
  the options, keep a Jira tab open: the search reuses your Jira session through
  that tab.
- Assignment goes through Jira's **REST API** (`PUT …/assignee`) reusing the tab's
  session — no extra permission, no token to enter.

### Other features

- **In-page copy** — a button is added to the Jira ticket actions and opens a side
  panel on the right with the same interface and the same customizable formats as
  the popup.
- **History** — the last copied tickets appear in the popup as well as the side
  panel, one-click re-copy (in your preferred format).
- **Multi-ticket copy** — on board / backlog / list views, a button copies the
  **checked** tickets as a Markdown checklist (configurable template), with
  "check/uncheck all", in the popup as well as the side panel.
- **Rich-format copy** — Markdown formats (link, PR description, checklist) are
  also copied as HTML: the link is clickable when pasted into a rich editor
  (Confluence, Docs, Slack…).
- **Last format remembered** — the last copied format is highlighted (a "last"
  badge) and can be triggered with `Enter`.
- **Manual entry** — if no ticket is detected, a field lets you type a key
  (e.g. `DEMO-1234`) to build the copies.
- **Additional fields** — type, status, assignee and priority are extracted
  (best-effort) and shown as colored chips.
- **Extra instances** — the page button appears automatically on
  `*.atlassian.net`; for a self-hosted instance, add its address in the options
  (the browser will ask for permission to access that site).
- **Import / Export** — save and restore your settings as JSON.
- **Language** — popup / panel interface in French or English (auto by default).

### Extraction

Extraction works on any Jira instance (no URL to configure): it reads the URL
first (`/browse/KEY`, `?selectedIssue=KEY`), then the tab title, then the DOM
(breadcrumb / `h1` / Jira Cloud testids), including the "Spaces" view. As a last
resort, missing fields (title, type, status, parent…) are completed through
Jira's **REST API**, reusing the tab's session.

The popup follows the system **light/dark theme** and respects
`prefers-reduced-motion`.

## Installation (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the extension folder (repository root)

- Customize the formats: right-click the icon → **Options**, or the
  "⚙︎ Customize formats" link in the popup.
- Change the keyboard shortcuts: `chrome://extensions/shortcuts`.

### Keyboard shortcuts

| Command                | Default shortcut   | Action                                |
| ---------------------- | ------------------ | ------------------------------------- |
| Toggle pane            | `Cmd/Ctrl+Shift+Y` | Open / close the Jira copy side panel |
| Copy "Key + title"     | `Cmd/Ctrl+Shift+U` | Copy the ticket key and title         |
| Copy git branch name   | *(unassigned)*     | Copy the git branch name              |
| Copy Markdown link     | *(unassigned)*     | Copy the Markdown link                |

The branch and Markdown commands ship without a default binding — assign one in
`chrome://extensions/shortcuts` if you use them.

## Structure

```
manifest.json      Extension manifest (permissions, action, commands, options)
background.js      Service worker: context menu + shortcuts + dynamic content scripts
template-engine.js Pure logic: template engine + transforms + Markdown→HTML (testable)
extract-core.js    Pure Jira DOM parsing logic (key, title, fields) — no globals (testable)
i18n.js            fr/en translations + t()
extract-fn.js      Bridge to extract-core + REST API + copy + toast (injected into the page)
page-buttons.js    Page button + side panel inside detected Jira pages
settings.js        Shared settings + storage access (popup / options / worker)
popup.html/.js     Popup on icon click (formats, history, multi)
options.html/.js   Options page: formats, instances, import/export, advanced settings
test/              Unit tests for the pure logic (node --test)
icons/             16 / 48 / 128 px icons
```

## Development

The pure logic (template engine, i18n, extraction DOM parsing) is covered by
tests. Extraction parsing is tested with a simulated DOM (jsdom) fed by HTML
fixtures (`test/fixtures/`); install the dev dependencies first:

```
npm install     # jsdom (dev dependency for the extraction tests)
npm test        # or: node --test
```

## Permissions

- `activeTab` + `scripting`: read the ticket on the active tab at the moment you
  trigger a popup / shortcut / context-menu action (works on any Jira instance).
- Content script on `*.atlassian.net`: automatically show the button and copy
  panel on Jira Cloud.
- `optional_host_permissions`: requested on the fly for the extra Jira instances
  you add in the options (self-hosted / custom domains), where the content script
  is then registered dynamically.
- `contextMenus`: right-click menu entry.
- `storage`: remember your custom formats (synced through your account) and the
  history / last used format (local storage).

## License

This project is distributed under the [MIT](LICENSE) license.
