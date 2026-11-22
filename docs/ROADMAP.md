# Roadmap

Chaque phase est un **milestone GitHub** ; chaque ligne devient une **issue**.
Taille : S ≈ moins d'une demi-journée d'agent, M ≈ une session, L ≈ à redécouper avant de commencer.
`agent-ready` : la tâche est assez précise pour être confiée à un sous-agent sans supervision.

## M0 : Fondations (le projet se construit, se teste et se package)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 0.1 | Scaffold electron-vite + React + TS strict, arborescence `src/{main,pty-host,preload,renderer,shared}` | shell | M | ✓ |
| 0.2 | ESLint + Prettier + Vitest + script `typecheck` | shell | S | ✓ |
| 0.3 | CI GitHub Actions : typecheck, lint, test, e2e sous xvfb | shell | S | ✓ |
| 0.4 | Contrat IPC typé + validation zod côté main + 1 test | shell | M | ✓ |
| 0.5 | Couche SQLite (better-sqlite3) + migrations numérotées | shell | M | ✓ |
| 0.6 | Packaging electron-builder : AppImage + pacman + `.desktop` | shell | S | ✓ |
| 0.7 | Tokens du design system + thème sombre/clair + composants de base (Button, Input, Tabs, Panel) | shell | M | ✓ |

**Critère de sortie** : `npm run dist` produit une AppImage qui ouvre une fenêtre vide aux bonnes couleurs, et la CI est verte.

## M1 : Projets et terminaux (l'appli remplace Konsole)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 1.1 | Disposition en 3 panneaux redimensionnables, avec sauvegarde et restauration de la disposition | shell | M | ✓ |
| 1.2 | Registre de projets : ajout (sélecteur de dossier, glisser-déposer, scan d'un dossier) et suppression | projects | M | ✓ |
| 1.3 | Lecture de l'état git (branche, fichiers modifiés, commits d'avance/de retard) + tests sur un vrai repo temporaire | projects | M | ✓ |
| 1.4 | Barre latérale projets → worktrees | projects | M | ✓ |
| 1.5 | Créer/supprimer un worktree (avec garde-fou sur les changements non commités) | projects | M | ✓ |
| 1.6 | Processus `pty-host` séparé + node-pty + protocole avec le main | terminals | L | |
| 1.7 | Composant terminal xterm.js (WebGL, liens, recherche), onglets et splits | terminals | M | ✓ |
| 1.8 | Scrollback persistant et restauration des terminaux au redémarrage | terminals | M | ✓ |
| 1.9 | Palette de commandes (Ctrl+K) + registre de commandes + raccourcis modifiables | palette | M | ✓ |
| 1.10 | Sélecteur rapide Ctrl+P (projets et worktrees) | palette | S | ✓ |
| 1.11 | Import Orca : lecteur en lecture seule de `profile-state.db` (repos, worktreeMeta, workspaceDir) + tests sur une base fixture | projects | M | ✓ |
| 1.12 | Écran d'import Orca au premier lancement (aperçu, cases à cocher) + commande « Réimporter depuis Orca » | projects | S | ✓ |
| 1.13 | Instance unique + CLI `workflow-ultimate --action <id>` (repli pour les raccourcis globaux) | shell | S | ✓ |
| 1.14 | Raccourcis globaux via le portail xdg GlobalShortcuts (Meta+W, Meta+Shift+J/N/A) | shell | M | |

**Critère de sortie** : une journée de terminaux multi-projets dans l'appli, avec les repos Orca importés ; un `kill` du renderer ne coupe aucun shell ; Meta+W affiche ou masque l'appli.

## M2 : Agents (Claude Code et Codex dans des worktrees)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 2.1 | Socket local d'événements (`$XDG_RUNTIME_DIR/workflow-ultimate.sock`) + format des événements | agents | M | ✓ |
| 2.2 | Adaptateur Claude Code : lancement, injection des hooks `Notification`/`Stop` via `--settings`, reprise | agents | M | |
| 2.3 | Adaptateur Codex : lancement, `notify`, reprise | agents | M | |
| 2.4 | Script `fake-agent` qui imite les deux CLI, pour les tests et la CI | agents | S | ✓ |
| 2.5 | Machine à états de l'agent + tests (démarrage → travaille → attend → terminé/erreur) | agents | S | ✓ |
| 2.6 | Onglet agent : terminal + en-tête d'état + boutons (interrompre, reprendre) | agents | M | ✓ |
| 2.7 | Vue d'ensemble de tous les agents (Ctrl+Shift+A) + Ctrl+J pour aller au prochain agent en attente | agents | M | ✓ |
| 2.8 | Tray KDE avec badge + notifications freedesktop cliquables | shell | M | |
| 2.9 | Fenêtre de lancement rapide (Meta+Shift+N) : prompt → agent dans le projet actif | agents | S | ✓ |

**Critère de sortie** : 3 agents en parallèle sur 2 projets, dont l'état s'affiche correctement en moins de 1 s.

## M3 : Review et git (on fusionne sans quitter l'appli)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 3.1 | Diff du worktree par rapport à sa base (Monaco diff), liste des fichiers, Alt+↓/↑ | review | M | ✓ |
| 3.2 | Commentaires sur une ligne + « envoyer à l'agent » (un seul message groupé) | review | M | ✓ |
| 3.3 | Commit (message proposé par l'agent ou saisi), push | review | S | ✓ |
| 3.4 | Création de PR via `gh` + affichage de l'état CI dans le panneau de contexte | review | M | ✓ |

**Critère de sortie** : du worktree à la PR ouverte entièrement au clavier.

## M4 : Orchestration (on distribue le travail aux agents)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 4.1 | Modèle Tâche (SQLite) + tableau Kanban par projet | orchestration | M | ✓ |
| 4.2 | Import et synchronisation des issues GitHub (`gh issue list --json`) | orchestration | M | ✓ |
| 4.3 | « Envoyer à un agent » : création du worktree, prompt construit depuis la tâche, lien entre tâche et session | orchestration | M | |
| 4.4 | File d'attente + nombre max d'agents simultanés | orchestration | S | ✓ |
| 4.5 | Passage automatique de la tâche en « En revue » quand l'agent a fini et qu'une PR existe | orchestration | S | ✓ |

**Critère de sortie** : du ticket GitHub à la PR sans toucher la souris (critère de succès n°4 de la spec).

## M5 : Stabilité et finitions (v1.0)

| # | Tâche | Module | Taille | agent-ready |
|---|---|---|---|---|
| 5.1 | Mesure et optimisation du démarrage à froid (< 1,5 s) | shell | M | |
| 5.2 | Test de reprise après plantage (kill du renderer, puis du main) en e2e | shell | M | ✓ |
| 5.3 | Option « suivre le thème KDE » (lecture de `kdeglobals`) | shell | S | ✓ |
| 5.4 | Audit d'accessibilité (axe-core en e2e) + corrections | shell | M | ✓ |
| 5.5 | Journaux locaux et page « Diagnostic » (version, chemins, socket, agents détectés) | shell | S | ✓ |
| 5.6 | Release v1.0 : CHANGELOG, tag, AppImage et PKGBUILD publiés | shell | S | |

## Après la v1 (non planifié, une spec par module avant de commencer)

`browser` (navigateur intégré pour les agents) · `knowledge` (graphify par projet, questions au code) ·
`automations` (tâches planifiées) · `learning` (parcours, notes, révision) · `plugins` (API d'extension) ·
runner KRunner · support d'autres CLI (aider, gemini, opencode) · usage et coûts des tokens par agent.
