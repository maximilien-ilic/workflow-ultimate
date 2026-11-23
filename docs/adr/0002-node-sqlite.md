# ADR-0002 : `node:sqlite` plutôt que `better-sqlite3`

- Statut : accepté
- Date : 2026-11-23

## Contexte

La spec prévoyait `better-sqlite3`. C'est un module natif : il faut le recompiler pour l'ABI d'Electron
à chaque montée de version (`electron-builder install-app-deps` ou `@electron/rebuild`), et il complique le packaging.
Electron 45 embarque Node 24.22, qui fournit `node:sqlite` (`DatabaseSync`, API synchrone, SQLite 3.54).

## Décision

Utiliser `node:sqlite` dans le processus main. Vérifié : il fonctionne dans Electron 45 (WAL compris) et sous Node 26 pour Vitest.

## Conséquences

- Aucune dépendance native pour la base : pas de recompilation, des installations et un packaging plus simples.
- `node:sqlite` est encore marqué « release candidate » dans Node 24. Si son API change ou casse, on revient à
  `better-sqlite3` : l'API est proche (`prepare().get/all/run`, `exec`), et tout passe par `src/main/modules/shell/db.ts`.
- `node-pty` reste un module natif : la recompilation arrivera avec le ticket #13 (pty-host), pas avant.
