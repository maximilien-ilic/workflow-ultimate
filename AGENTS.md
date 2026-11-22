# AGENTS.md

Appli de bureau Electron + React + TS pour piloter des agents IA sous KDE Plasma. Lire avant de coder :

1. `docs/SPEC.md` : quoi construire, stack, commandes, limites (**à respecter**).
2. `docs/DESIGN.md` : tokens, disposition, raccourcis (pour toute interface).
3. `docs/ORCHESTRATION.md` : branches, PR, cycle d'une tâche.

## Règles

- Un ticket = une branche `feat/<n>-slug` = une PR qui contient `Closes #n`.
- TDD : écrire le test qui échoue d'abord. `npm run typecheck && npm run lint && npm test` doivent passer avant chaque commit.
- Le code va dans `src/{main,renderer}/modules/<module-id>/`, avec les ids de module de la spec uniquement.
- Le plus petit changement qui résout tout le ticket ; pas d'abstraction ni d'option non demandée.
- Un raccourci avec une limite connue porte un commentaire `// shortcut: <la limite>, <quand l'améliorer>`.
- Demander avant : d'ajouter une dépendance, de changer le schéma SQLite, la CI ou un contrat IPC existant.
- Jamais : de secrets dans le code ; de test désactivé ou supprimé pour passer au vert ; de fusion sans CI verte ET relecture de l'autre agent sans point bloquant (seul Claude fusionne, voir docs/ORCHESTRATION.md §5).

## Skills tiers (`.agents/skills/`)

Ce sont des **références**, pas des règles. En cas de désaccord, AGENTS.md, la spec et les ADR priment. Revues de Codex sur #53 :
- Ne jamais lancer les scripts des skills (scaffold, génération) : ils écrasent des fichiers existants.
- Ne jamais désactiver le sandbox Electron ou Chromium, ni lancer des tests en root, même si un skill le suggère pour la CI.
- `shell.openExternal` et les permissions : refus par défaut, avec une liste exacte d'URL ou d'origines autorisées, vérifiées sur le frame qui fait la demande.
- Ne jamais écrire de sessions, cookies ou dumps de débogage dans le repo.
