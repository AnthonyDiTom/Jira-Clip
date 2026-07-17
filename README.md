# Jira Ticket Copier

Extension Chrome (Manifest V3) qui récupère le **numéro** et le **titre** d'un ticket Jira
et les copie dans le presse-papier, dans des formats **personnalisables**.

Exemple sur un ticket :
`DEMO-1234 Feature demo - Improve ticket copy examples`

## Fonctionnalités

Quatre façons de déclencher la copie :

| Déclencheur                  | Comportement                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| **Bouton dans Jira**         | Bouton près des actions du ticket, panneau latéral avec l'interface de la popup |
| **Clic sur l'icône**         | Popup : ticket détecté, boutons de copie, historique, multi   |
| **Raccourci clavier**        | `Cmd/Ctrl+Shift+U` — « Numéro + titre » (+ raccourcis branche / markdown) |
| **Clic droit → Ticket Jira** | Sous-menu avec tous les formats                               |

### Formats de copie (personnalisables)

Formats fournis par défaut :

- **Numéro + titre** — `DEMO-1234 Feature demo - …`
- **Nom de branche git** — `feature/DEMO-1234-feature-demo-…`
  (préfixe choisi selon le **type d'issue**, clé conservée, titre en kebab-case)
- **Commande git switch** — `git switch -c feature/DEMO-1234-…` (prêt à coller)
- **Message de commit** — `feat(DEMO-1234): Feature demo - …` (type Conventional Commits déduit du type d'issue)
- **Lien Markdown** — `[DEMO-1234](https://…/browse/DEMO-1234) Feature demo - …`
- **Numéro seul** — `DEMO-1234`
- **Description de PR** — squelette Markdown pré-rempli (lien, contexte, changements, tests)

Chaque format est un **gabarit** modifiable dans la page d'options, avec ces variables :

`{key}` `{title}` `{titleMd}` (échappé Markdown) `{slug}` `{url}`
`{type}` `{status}` `{assignee}` `{priority}`
`{commitType}` `{branchPrefix}` `{branch}` (= préfixe + clé + slug)

`{commitType}` et `{branchPrefix}` sont déduits du type d'issue via des
correspondances éditables (ex. `bug → fix` / `bugfix/`).

### Autres fonctionnalités

- **Copie dans la page** — un bouton s'ajoute aux actions du ticket Jira et ouvre
  un panneau latéral à droite avec la même interface et les mêmes formats
  personnalisables que la popup.
- **Historique** — les derniers tickets copiés apparaissent dans la popup, recopie en un clic.
- **Copie multi-tickets** — sur les vues board / backlog / liste, un bouton copie
  tous les tickets détectés sous forme de checklist Markdown (gabarit configurable).
- **Champs additionnels** — type, statut, assigné et priorité sont extraits
  (best-effort) et affichés en puces dans la popup.

### Extraction

L'extraction fonctionne sur n'importe quelle instance Jira (aucune URL à configurer) :
elle lit d'abord l'URL (`/browse/KEY`, `?selectedIssue=KEY`), puis le titre de l'onglet,
puis le DOM (fil d'Ariane / `h1` / testids Jira Cloud), y compris la vue « Spaces ».

La popup suit le **thème clair/sombre** du système et respecte `prefers-reduced-motion`.

## Installation (mode développeur)

1. Ouvrez `chrome://extensions`
2. Activez le **Mode développeur** (en haut à droite)
3. Cliquez sur **Charger l'extension non empaquetée**
4. Sélectionnez le dossier `JiraWebExtension`

- Personnaliser les formats : clic droit sur l'icône → **Options**, ou le lien « ⚙︎ Personnaliser les formats » dans la popup.
- Changer les raccourcis clavier : `chrome://extensions/shortcuts`.

## Structure

```
manifest.json     Déclaration de l'extension (permissions, action, commandes, options)
background.js     Service worker : menu contextuel (dynamique) + raccourcis + historique
extract-fn.js     Extraction + moteur de gabarits + multi-tickets + copie (injecté dans la page)
page-buttons.js   Bouton de page + panneau latéral dans les pages Jira détectées
settings.js       Réglages partagés + accès au stockage (popup / options / worker)
popup.html/.js    Popup au clic sur l'icône (formats, historique, multi)
options.html/.js  Page d'options : gestion des formats + réglages avancés
icons/            Icônes 16 / 48 / 128 px
```

## Permissions

- `activeTab` + `scripting` : lire le ticket sur l'onglet actif au moment où vous
  déclenchez une action popup / raccourci / menu contextuel.
- Script de contenu `http/https` : afficher le bouton et le panneau de copie dans
  les pages qui ressemblent à Jira.
- `contextMenus` : entrée de menu au clic droit.
- `storage` : mémoriser vos formats personnalisés et l'historique (synchronisé via le compte,
  historique local).
