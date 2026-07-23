# Jira Ticket Copier

Extension Chrome (Manifest V3) qui récupère le **numéro** et le **titre** d'un ticket Jira
et les copie dans le presse-papier, dans des formats **personnalisables**.

Exemple sur un ticket :
`DEMO-1234 Feature demo - Improve ticket copy examples`

## Fonctionnalités

Quatre façons de déclencher la copie :

| Déclencheur                  | Comportement                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| **Bouton dans Jira**         | Bouton près des actions du ticket, panneau latéral avec l'interface de la popup (`Cmd/Ctrl+Shift+Y` pour l'ouvrir/fermer, `Échap` pour fermer) |
| **Clic sur l'icône**         | Popup : ticket détecté, boutons de copie, historique, multi (touches `1`–`9` = copie du format correspondant, `Entrée` = dernier format utilisé) |
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

`{key}` `{title}` `{titleRaw}` (titre non nettoyé) `{titleMd}` (échappé Markdown)
`{titleLower}` `{slug}` `{url}`
`{type}` `{status}` `{assignee}` `{priority}` `{project}` `{parentKey}`
`{commitType}` `{branchPrefix}` `{branch}` (= préfixe + clé + slug) `{date}` (date du jour, AAAA-MM-JJ)

Ajoutez `:N` à une variable pour la tronquer, ex. `{slug:40}` ou `{title:60}`.

`{project}` est déduit de la clé (`DEMO-1234` → `DEMO`). `{parentKey}` (ticket
parent / epic) est rempli au mieux via l'API REST de Jira.

Dans la page d'options, cliquez sur une variable pour l'insérer directement
dans le gabarit sélectionné.

Chaque format affiche un **aperçu en direct** calculé sur un ticket d'exemple :
le **texte copié** (brut) et, pour les gabarits Markdown, le **rendu** tel qu'il
sera collé dans un éditeur riche (Slack, Confluence…).

`{commitType}` et `{branchPrefix}` sont déduits du type d'issue via des
correspondances éditables (ex. `bug → fix` / `bugfix/`).

#### Nettoyage du titre

Dans les **réglages avancés**, le titre peut être nettoyé avant de générer les
formats (slug / branche / commit) :

- Case **« Ignorer les tags entre crochets »** : retire automatiquement les
  `[FRONT]`, `[BE]`… sans écrire de motif.
- Liste de **motifs** supplémentaires (expressions régulières, un par ligne),
  ex. `/^\s*wip:?/i` retire un préfixe « WIP: ».

La casse est ignorée par défaut ; la forme `/motif/flags` permet de préciser
les drapeaux. Le nettoyage s'applique à `{title}`, `{slug}`, `{branch}`… ;
`{titleRaw}` conserve toujours le titre d'origine.

### Auto-assignation

Assignez un ticket en un clic à des personnes que vous choisissez (**5 maximum**),
en plus d'un bouton **« M'assigner »**.

- Chaque personne configurée devient un **bouton d'assignation rapide**, à la fois
  dans le **panneau latéral** (section « Assigner à ») et dans la **barre d'actions**
  du ticket (petits avatars à côté du bouton ⧉).
- **Choix des personnes** : recherche par nom / e-mail, soit depuis la zone
  « Gérer les personnes » du panneau (directement sur une page Jira), soit depuis
  la page d'**options**. Depuis les options, gardez un onglet Jira ouvert : la
  recherche réutilise votre session Jira via cet onglet.
- L'assignation passe par l'**API REST de Jira** (`PUT …/assignee`) en réutilisant
  la session de l'onglet — aucune permission supplémentaire, aucun token à saisir.

### Autres fonctionnalités

- **Copie dans la page** — un bouton s'ajoute aux actions du ticket Jira et ouvre
  un panneau latéral à droite avec la même interface et les mêmes formats
  personnalisables que la popup.
- **Historique** — les derniers tickets copiés apparaissent dans la popup comme
  dans le panneau latéral, recopie en un clic (au format préféré).
- **Copie multi-tickets** — sur les vues board / backlog / liste, un bouton copie
  les tickets **cochés** sous forme de checklist Markdown (gabarit configurable),
  avec « tout cocher / décocher », dans la popup comme dans le panneau latéral.
- **Copie au format riche** — les formats Markdown (lien, description de PR,
  checklist) sont aussi copiés en HTML : le lien est cliquable quand on le colle
  dans un éditeur riche (Confluence, Docs, Slack…).
- **Dernier format mémorisé** — le dernier format copié est mis en avant (badge
  « dernier ») et déclenchable par `Entrée`.
- **Saisie manuelle** — si aucun ticket n'est détecté, un champ permet de saisir
  une clé (ex. `DEMO-1234`) pour construire les copies.
- **Champs additionnels** — type, statut, assigné et priorité sont extraits
  (best-effort) et affichés en puces colorées.
- **Instances supplémentaires** — le bouton de page apparaît automatiquement sur
  `*.atlassian.net` ; pour une instance auto-hébergée, ajoutez son adresse dans
  les options (le navigateur demande l'autorisation d'accès à ce site).
- **Import / Export** — sauvegarde et restauration des réglages en JSON.
- **Langue** — interface popup / panneau en français ou anglais (auto par défaut).

### Extraction

L'extraction fonctionne sur n'importe quelle instance Jira (aucune URL à configurer) :
elle lit d'abord l'URL (`/browse/KEY`, `?selectedIssue=KEY`), puis le titre de l'onglet,
puis le DOM (fil d'Ariane / `h1` / testids Jira Cloud), y compris la vue « Spaces ».
En dernier recours, les champs manquants (titre, type, statut, parent…) sont
complétés via l'**API REST** de Jira, en réutilisant la session de l'onglet.

La popup suit le **thème clair/sombre** du système et respecte `prefers-reduced-motion`.

## Installation (mode développeur)

1. Ouvrez `chrome://extensions`
2. Activez le **Mode développeur** (en haut à droite)
3. Cliquez sur **Charger l'extension non empaquetée**
4. Sélectionnez le dossier de l'extension (racine du dépôt)

- Personnaliser les formats : clic droit sur l'icône → **Options**, ou le lien « ⚙︎ Personnaliser les formats » dans la popup.
- Changer les raccourcis clavier : `chrome://extensions/shortcuts`.

## Structure

```
manifest.json      Déclaration de l'extension (permissions, action, commandes, options)
background.js      Service worker : menu contextuel + raccourcis + content scripts dynamiques
template-engine.js Logique pure : moteur de gabarits + transformations + Markdown→HTML (testable)
extract-core.js    Logique pure de parsing du DOM Jira (clé, titre, champs) — sans globales (testable)
i18n.js            Traductions fr/en + t()
extract-fn.js      Pont vers extract-core + API REST + copie + toast (injecté dans la page)
page-buttons.js    Bouton de page + panneau latéral dans les pages Jira détectées
settings.js        Réglages partagés + accès au stockage (popup / options / worker)
popup.html/.js     Popup au clic sur l'icône (formats, historique, multi)
options.html/.js   Page d'options : formats, instances, import/export, réglages avancés
test/              Tests unitaires de la logique pure (node --test)
icons/             Icônes 16 / 48 / 128 px
```

## Développement

La logique pure (moteur de gabarits, i18n, parsing du DOM d'extraction) est
couverte par des tests. Le parsing d'extraction est testé avec un DOM simulé
(jsdom) alimenté par des fixtures HTML (`test/fixtures/`) ; installez d'abord
les dépendances de dev :

```
npm install     # jsdom (dépendance de dev pour les tests d'extraction)
npm test        # ou : node --test
```

## Permissions

- `activeTab` + `scripting` : lire le ticket sur l'onglet actif au moment où vous
  déclenchez une action popup / raccourci / menu contextuel (fonctionne sur
  n'importe quelle instance Jira).
- Script de contenu sur `*.atlassian.net` : afficher automatiquement le bouton et
  le panneau de copie sur Jira Cloud.
- `optional_host_permissions` : demandées à la volée pour les instances Jira
  supplémentaires que vous ajoutez dans les options (self-hosted / domaines
  personnalisés), où le content script est alors enregistré dynamiquement.
- `contextMenus` : entrée de menu au clic droit.
- `storage` : mémoriser vos formats personnalisés (synchronisés via le compte) et
  l'historique / le dernier format utilisé (stockage local).

## Licence

Ce projet est distribué sous licence [MIT](LICENSE).
