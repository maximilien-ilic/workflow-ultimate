# Spec : Workflow Ultimate

> Statut : **validé le 2026-11-22**. Document vivant : on le met à jour avant de changer le code.

## 1. Objectif

Un poste de pilotage d'agents IA personnel, sur le modèle d'Orca, qui tourne sous Linux / KDE Plasma 6 (Wayland).
Il doit permettre de :

- passer d'un projet à l'autre en moins de 2 secondes, au clavier ;
- lancer plusieurs agents (Claude Code, Codex) en parallèle, chacun dans son propre worktree git ;
- savoir d'un coup d'œil quel agent travaille, lequel attend une réponse et lequel a fini ;
- relire, commenter et fusionner le travail d'un agent sans quitter l'appli ;
- découper un objectif en tâches et les distribuer aux agents.

**Utilisateur** : une seule personne (toi), développeur sous Arch Linux + KDE, qui pilote plusieurs projets à la fois.
**Hors périmètre v1** : le module « apprendre » (cours, notes, révision), le multi-utilisateur, le cloud, Windows/macOS.

## 2. Carte des capacités (modules)

Les ids des modules sont stables : les tickets, les branches et les specs de module y font référence.

| Module id | Responsabilité | Dépend de |
|---|---|---|
| `shell` | Fenêtre Electron, IPC typé, réglages, base SQLite, raccourcis, intégration KDE (tray, notifications) | — |
| `projects` | Registre des repos, état git, création/suppression de worktrees | `shell` |
| `terminals` | PTY (node-pty) + xterm.js, onglets/splits, scrollback persistant | `shell` |
| `agents` | Adaptateurs Claude Code / Codex : lancement dans un worktree, détection d'état, reprise de session | `projects`, `terminals` |
| `review` | Diff d'un worktree, commentaires, commit, push, PR via `gh` | `projects` |
| `orchestration` | Tableau de tâches, envoi d'une tâche à un agent, file d'attente, alertes « attend une réponse » | `agents`, `review` |
| `palette` | Palette de commandes (Ctrl+K) : chaque action de l'appli y est exposée | `shell` (chaque module y enregistre ses commandes) |

Ordre de construction : `shell` → `projects`, `terminals`, `palette` → `agents` → `review` → `orchestration`.

Modules prévus **après la v1** (ne pas coder avant) : `browser` (navigateur intégré), `knowledge` (graphify par projet),
`automations` (tâches planifiées), `learning`, `plugins` (API d'extension).

## 3. Fonctionnalités v1 et critères d'acceptation

### shell
- L'appli démarre en moins de 1,5 s (démarrage à froid, mesuré) et restaure la dernière disposition (projet, onglets, tailles des panneaux).
- Les réglages sont stockés dans `~/.config/workflow-ultimate/` et les données (SQLite) dans `~/.local/share/workflow-ultimate/`.
- Icône dans le tray KDE (StatusNotifierItem) avec un badge quand un agent attend une réponse.
- Notifications natives (freedesktop) quand un agent finit ou attend une réponse et que la fenêtre est sans focus. Un clic affiche son onglet. Le menu du tray permet de couper le son des notifications.
- **Raccourcis globaux** (même quand la fenêtre n'a pas le focus) via le portail xdg `GlobalShortcuts`, que KDE supporte (feature Electron `GlobalShortcutsPortal`). Ils apparaissent et se modifient dans Configuration système → Raccourcis. Repli : des actions du `.desktop` / la CLI `workflow-ultimate --action <id>` envoyées à l'instance unique, à lier à un raccourci KDE.
- Si l'appli plante, elle repart sur le même état (les PTY des agents tournent dans un processus séparé et survivent au rechargement de l'interface).

### projects
- Ajouter un repo (glisser-déposer, sélecteur de dossier, ou scan de `~/orca/projects`).
- Barre latérale : projets → worktrees, avec la branche, le nombre de fichiers modifiés et les commits d'avance ou de retard.
- Créer un worktree depuis une branche ou un ticket GitHub (`#12` → branche `feat/12-slug`), et le supprimer proprement (alerte s'il reste des changements non commités).

- **Import Orca au premier lancement** : on lit `~/.config/orca/profiles/*/profile-state.db` (SQLite, **lecture seule**, table `profile_state_documents`, domaines `repos`, `worktreeMeta` et `settings.workspaceDir`), on affiche un aperçu (repos, worktrees, dossier de workspaces) et l'utilisateur coche ce qu'il importe. Les worktrees sont revérifiés avec `git worktree list` : ceux qui n'existent plus sont ignorés. On ne touche jamais aux fichiers d'Orca. L'import peut se relancer depuis la palette.

### terminals
- Plusieurs terminaux par worktree, en onglets et en splits horizontaux/verticaux.
- Rendu GPU (addon WebGL de xterm.js), liens cliquables, recherche dans le scrollback, images (sixel), avec un repli si le GPU est indisponible.
- L'appli sauvegarde jusqu'à 10 000 lignes par terminal toutes les cinq secondes quand le contenu change et à la fermeture de la fenêtre. Elle restaure les onglets et splits, affiche « session restaurée » et ouvre un nouveau shell dans le dernier dossier sauvegardé. Les fichiers d'historique (permissions 0600) sont supprimés quand on ferme leur volet.

### agents
- Lancer Claude Code ou Codex dans un worktree en 1 action (palette ou bouton), avec un prompt initial facultatif.
- État de chaque agent : `démarrage`, `travaille`, `attend une réponse`, `terminé`, `erreur`. Il vient des hooks des CLI (Claude Code : `Notification`/`Stop` ; Codex : `notify`), qui écrivent sur un socket local de l'appli. Lire la sortie du terminal sert seulement de repli.
- Reprendre une session existante (`claude --resume`, `codex resume`).
- Vue d'ensemble : tous les agents de tous les projets sur un seul écran, triés par « attend une réponse » d'abord.

### review
- Diff du worktree par rapport à sa base (éditeur Monaco en mode diff), fichier par fichier, avec un raccourci pour passer au fichier modifié suivant.
- Commentaires sur les lignes du diff, conservés en SQLite par worktree. Les commentaires en attente sont envoyés en un seul message à un agent disponible du worktree. Leur statut passe à « Envoyé » après confirmation de l’écriture dans le PTY.
- Commit des fichiers sélectionnés avec un message saisi ou demandé à un agent, push et création de PR (`gh pr create`) depuis l'appli. Le push cible la branche courante et son upstream. Le panneau affiche l'état CI de la PR.
- Le panneau de contexte prépare le titre et la description éditables de la PR à partir du dernier commit et ajoute `Closes #n` si le nom de branche désigne un ticket. La branche doit être poussée avant la création de la PR. Le panneau affiche un lien vers GitHub et rafraîchit les vérifications CI toutes les 30 secondes quand il est visible.
- Une branche réutilisée après la fermeture ou la fusion d'une PR propose un nouveau brouillon dès qu'elle n'a plus de PR ouverte.

### orchestration
- Tableau de tâches par projet (À faire / En cours / En revue / Fini), qu'on peut importer depuis les issues GitHub.
- Le tableau annonce les refus d'enregistrement et conserve la saisie pour permettre sa correction au clavier.
- « Envoyer à un agent » : crée le worktree, lance Claude Code ou Codex avec le titre, la description, le lien vers la spec et le rappel d’AGENTS.md. Après un lancement réussi, la tâche est liée à la session et passe en « En cours ».
- Le tableau affiche la file d’attente et permet de la réordonner au clavier. Le réglage du nombre d’agents simultanés (3 par défaut) reporte les nouveaux envois jusqu’à ce qu’une place se libère.

### palette
- Ctrl+K ouvre la palette ; recherche floue sur les commandes, projets, worktrees, sessions et tâches.
- Chaque action a un raccourci modifiable, et les raccourcis apparaissent dans la palette.

## 4. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Appli | Electron (dernière version stable au moment du scaffold) | Les terminaux les plus stables sous Linux/Wayland, la même base qu'Orca. Voir [ADR-0001](adr/0001-electron-react-ts.md). |
| Build | electron-vite | Un seul outil pour les processus main, preload et renderer. |
| UI | React + TypeScript strict | Langage que les agents écrivent le mieux. |
| Style | Tailwind CSS + primitives Radix | Composants accessibles, styles via des tokens (voir `DESIGN.md`). |
| État UI | Zustand | Plus simple que Redux pour une appli mono-utilisateur. |
| Terminal | `@xterm/xterm` + addons, `node-pty` | Le standard (VS Code, Orca). |
| Diff/éditeur | Monaco | Mode diff intégré. |
| Données | SQLite via `node:sqlite` (intégré à Node/Electron) | Local, synchrone, sans module natif. Voir [ADR-0002](adr/0002-node-sqlite.md). |
| Git/GitHub | CLI `git` et `gh` lancés comme sous-processus | Pas de réimplémentation : on s'appuie sur des outils éprouvés. |
| Tests | Vitest (unitaires), Playwright pour Electron (e2e) | |
| Paquets | electron-builder : AppImage + paquet pacman | Tu es sur Arch. |
| Gestionnaire de paquets | npm | Déjà installé. node-pty se compile mal avec bun. |

## 5. Commandes

```
npm install          # installe les dépendances et recompile les modules natifs (postinstall)
npm run dev          # appli en mode dev, rechargement à chaud
npm run typecheck    # tsc --noEmit sur main, preload et renderer
npm run lint         # eslint . (+ --fix)
npm test             # vitest run
npm run test:e2e     # playwright test (Electron)
npm run build        # build de production
npm run dist         # AppImage + pacman dans dist/
```

## 6. Structure du projet

```
src/
  main/            → processus principal Electron (fenêtres, IPC, cycle de vie)
    modules/<id>/  → logique côté système, un dossier par module id
  pty-host/        → processus séparé qui garde les PTY (il survit au rechargement de l'interface)
  preload/         → pont IPC typé exposé au renderer
  renderer/        → interface React
    modules/<id>/  → composants et stores, un dossier par module id
    ui/            → design system (tokens, composants de base)
  shared/          → types et contrats IPC partagés (aucun import Node ni DOM)
tests/e2e/         → tests Playwright
docs/              → SPEC, DESIGN, ROADMAP, ORCHESTRATION, adr/
```

Les tests unitaires sont posés à côté du code (`foo.ts` → `foo.test.ts`).

## 7. Style de code

```ts
// src/shared/ipc.ts : un seul contrat, typé, pour toute communication main ↔ renderer
export type IpcContract = {
  'worktree:create': (req: { projectId: string; branch: string }) => Promise<Worktree>;
  'agent:start': (req: { worktreeId: string; kind: AgentKind; prompt?: string }) => Promise<AgentSession>;
};
export type AgentKind = 'claude-code' | 'codex';
```

- TypeScript `strict`, pas de `any` ni de `@ts-ignore` sans commentaire `shortcut:` qui explique la limite.
- Noms : fichiers en `kebab-case.ts`, composants en `PascalCase.tsx`, canaux IPC en `module:action`.
- Toutes les entrées venant du renderer sont validées dans le main (zod) : c'est une frontière de confiance.
- Pas d'abstraction « pour plus tard ». Un deuxième adaptateur d'agent justifie une interface, un seul non.

## 8. Stratégie de test

- **Unitaires (Vitest)** : parsers (état git, état d'agent), stores, contrats IPC. Toute logique non triviale a son test.
- **Intégration** : modules main avec un vrai repo git temporaire et un vrai PTY (pas de mock de git).
- **E2E (Playwright)** : un parcours par module (ajouter un projet, ouvrir un terminal, lancer un faux agent, voir un diff).
  Les agents sont remplacés par un script `fake-agent` qui imite les hooks, pour que la CI ne consomme pas d'API.
- La CI (GitHub Actions) lance `typecheck`, `lint`, `test` et `test:e2e` (sous xvfb) sur chaque PR.

## 9. Limites

- **Toujours** : lancer `npm run typecheck && npm test` avant de commiter ; un ticket = une branche = une PR ; mettre à jour la spec si le comportement change.
- **Demander d'abord** : ajouter une dépendance, changer le schéma SQLite, modifier la CI, changer un contrat IPC existant, ajouter un module hors v1.
- **Jamais** : commiter des secrets ou des tokens ; désactiver ou supprimer un test pour passer au vert ; lancer un agent avec des droits élevés (`--dangerously-skip-permissions`) sans action explicite de l'utilisateur dans l'interface.

## 10. Critères de succès v1

1. Une journée de travail complète sans repasser par Orca ni Konsole.
2. 3 agents en parallèle sur 2 projets, avec l'état correct de chacun affiché en moins de 1 s après un changement.
3. Aucune perte de session ni de scrollback après la fermeture et la réouverture de l'appli, ni après un plantage forcé de l'interface (`kill` du renderer).
4. Du ticket GitHub à la PR ouverte sans toucher la souris.
5. CI verte, AppImage installable, démarrage à froid < 1,5 s.

## 11. Décisions prises (2026-11-22)

- Nom : **Workflow Ultimate**.
- Import de la config Orca au premier lancement : oui (module `projects`).
- Raccourcis globaux hors fenêtre : oui (module `shell`, portail xdg).

## 12. Questions ouvertes

- Aucune pour l'instant.
