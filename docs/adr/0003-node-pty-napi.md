# ADR-0003 : `node-pty` sans recompilation pour Electron

- Statut : accepté
- Date : 2026-11-23

## Contexte

Les terminaux reposent sur `node-pty`, un module natif. Les modules natifs classiques doivent être recompilés
pour l'ABI d'Electron (`electron-builder install-app-deps`), ce qui oblige à garder deux builds (Node pour Vitest, Electron pour l'appli).
npm 12 bloque aussi par défaut les scripts d'installation des dépendances.

## Constat

`node-pty` 1.1 utilise `node-addon-api` (N-API, ABI stable). Un seul binaire, compilé à l'installation par node-gyp,
fonctionne sous Node 26 (Vitest), dans le main d'Electron 45 et dans un `utilityProcess`. Vérifié aussi dans l'AppImage :
electron-builder sort `pty.node` de l'asar (`app.asar.unpacked`).

## Décision

- Pas de `install-app-deps` ni de `@electron/rebuild`.
- `package.json` → `allowScripts` : on autorise les scripts d'installation de `node-pty` et `electron` (versions épinglées :
  une montée de version demande une nouvelle approbation avec `npm install-scripts approve <pkg>`). On refuse explicitement
  `electron-winstaller` (outil Windows d'electron-builder, inutile ici).

## Conséquences

- La compilation de `node-pty` demande `python`, `make` et `g++` (présents sur Arch avec `base-devel`, et sur les runners GitHub).
- Si une future version de `node-pty` abandonne N-API, il faudra rétablir `install-app-deps`.
