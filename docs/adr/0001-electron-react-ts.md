# ADR-0001 : Electron + React + TypeScript

- Statut : accepté
- Date : 2026-11-22

## Contexte

Il faut une appli de bureau pour KDE Plasma 6 sous Wayland. Son cœur, ce sont des terminaux et des processus d'agents.
Elle doit être stable, développée vite (en grande partie par des agents IA) et facile à étendre.

## Options

1. **Electron + React/TS** : xterm.js et node-pty, le même socle que VS Code et Orca ; écosystème énorme. Inconvénients : environ 150 Mo de RAM et un binaire lourd.
2. **Tauri 2** : léger, backend Rust. Sous Linux, il dépend de WebKitGTK, qui a des problèmes connus sous Wayland/NVIDIA, et xterm.js y tourne moins bien.
3. **Qt6/QML + Kirigami** : le plus natif KDE. Le développement est plus lent, il y a moins de briques prêtes (diff, terminal riche) et les agents IA le maîtrisent moins bien.

## Décision

Electron + React + TypeScript strict, construit avec electron-vite. Les PTY tournent dans un processus `pty-host` séparé, pour que le
rechargement ou le plantage de l'interface ne tue pas les agents.

## Conséquences

- On accepte le coût mémoire d'Electron.
- L'intégration KDE passe par les standards freedesktop (StatusNotifierItem, notifications, portails xdg) et non par des API Qt.
- Les modules natifs (node-pty, better-sqlite3) doivent être recompilés pour la version d'Electron utilisée (`electron-builder install-app-deps`).
