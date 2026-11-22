# Design : style, UX et UI

> Principe : **tout se fait au clavier, tout se voit d'un coup d'œil, rien ne bouge sans raison.**
> Même esprit que KDE (sobre, dense, configurable), mais avec une identité propre.

## 1. Principes UX

1. **Clavier d'abord.** Chaque action passe par la palette (Ctrl+K). La souris reste possible, jamais obligatoire.
2. **L'attention va à ce qui attend.** Un agent bloqué sur une question est l'info la plus importante de l'écran : badge, son discret (désactivable), entrée en tête de liste.
3. **Pas de modale bloquante** pour les actions courantes : on utilise des panneaux latéraux et des toasts avec « Annuler ».
4. **État toujours visible** : branche, fichiers modifiés, agent en cours, CI. Pas besoin d'ouvrir quoi que ce soit pour savoir où on en est.
5. **Densité réglable** : `compacte` (par défaut) ou `confortable`.
6. **Réversible** : supprimer un worktree avec des changements non commités demande confirmation ; tout le reste peut s'annuler.

## 2. Disposition

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ◉ projet ▸ worktree ▸ branche        [Ctrl+K rechercher…]      ●2 ◐1 ✓4   │ ← barre de titre (CSD)
├──────────┬──────────────────────────────────────────────┬─────────────────┤
│ PROJETS  │ [claude ●] [codex ◐] [term] [diff]       + │ CONTEXTE        │
│ ▾ app-a  │                                              │ Tâche #12       │
│   main   │                                              │ critères ☐☐☑   │
│   feat-12│        zone de travail                       │                 │
│ ▸ app-b  │        (terminal / agent / diff / tableau)   │ Fichiers modif. │
│          │                                              │ src/a.ts  +12-3 │
│ AGENTS   │                                              │                 │
│ ● feat-12│                                              │ PR #34  CI ✓    │
│ ◐ fix-9  │                                              │                 │
├──────────┴──────────────────────────────────────────────┴─────────────────┤
│ ● 2 travaillent  ◐ 1 attend  │ app-a · feat-12 · +3 ↑1 │ CPU 12% │ ⌨ Ctrl+K │ ← barre d'état
└───────────────────────────────────────────────────────────────────────────┘
```

- Barre latérale gauche (Ctrl+B pour la masquer) : projets → worktrees, puis la liste des agents actifs.
- Zone centrale en onglets, avec des splits (Ctrl+Shift+D vertical, Ctrl+Shift+E horizontal).
- Panneau droit de contexte (Ctrl+Alt+B) : la tâche liée, les fichiers modifiés, la PR et la CI.
- Mode focus (F11 / Ctrl+Shift+F) : seule la zone centrale reste affichée.
- **Vue d'ensemble** (Ctrl+Shift+A) : une grille de tous les agents, de tous les projets, avec l'aperçu des 5 dernières lignes de chacun.

## 3. États des agents (langage visuel unique)

| État | Icône | Couleur (token) | Comportement |
|---|---|---|---|
| démarrage | ○ | `--fg-muted` | — |
| travaille | ● (pulsation lente) | `--accent` | — |
| attend une réponse | ◐ | `--warn` | badge dans le tray + notification + tête de liste |
| terminé | ✓ | `--ok` | notification si la fenêtre n'a pas le focus |
| erreur | ✕ | `--danger` | notification et lien vers la sortie |

La couleur n'est jamais le seul indicateur : il y a toujours l'icône et le libellé (accessibilité).

## 4. Tokens visuels

Thème sombre par défaut, thème clair complet ; option « suivre le thème KDE » (lecture de `kdeglobals`, accent compris).

```css
:root[data-theme="dark"] {
  --bg:        #0f1115;  /* fond appli */
  --bg-raised: #161920;  /* panneaux */
  --bg-hover:  #1d212a;
  --border:    #262b36;
  --fg:        #e6e8ee;
  --fg-muted:  #8a91a3;
  --accent:    #3daee9;  /* bleu Breeze, remplacé par l'accent KDE si l'option est activée */
  --ok:        #3fb950;
  --warn:      #e3b341;
  --danger:    #f85149;
  --radius:    6px;
  --space:     4px;      /* grille de 4 px */
}
```

- **Typo interface** : Inter (ou police système KDE : Noto Sans), 13 px en compact, 14 px en confortable.
- **Typo code/terminal** : JetBrains Mono, ligatures désactivables, taille réglable par terminal (Ctrl+= / Ctrl+-).
- **Icônes** : Lucide, trait de 1,5 px, 16 px.
- **Mouvement** : 120 à 180 ms, en ease-out, uniquement pour les changements d'état. Coupé si `prefers-reduced-motion` est actif.

## 5. Raccourcis par défaut (tous modifiables)

| Action | Raccourci |
|---|---|
| Palette de commandes | Ctrl+K |
| Changer de projet / worktree | Ctrl+P |
| Nouvel agent dans le worktree courant | Ctrl+Shift+N |
| Nouveau terminal | Ctrl+Shift+T |
| Agent suivant qui attend une réponse | Ctrl+J |
| Vue d'ensemble des agents | Ctrl+Shift+A |
| Ouvrir le diff du worktree | Ctrl+Shift+G |
| Fichier modifié suivant / précédent (diff) | Alt+↓ / Alt+↑ |
| Tableau de tâches | Ctrl+Shift+K |
| Onglet n | Alt+1…9 |

### Raccourcis globaux (hors fenêtre, modifiables dans Configuration système → Raccourcis)

| Action | Raccourci |
|---|---|
| Afficher/masquer Workflow Ultimate | Meta+W |
| Aller au prochain agent qui attend une réponse | Meta+Shift+J |
| Lancement rapide : petite fenêtre « prompt → agent » dans le projet actif | Meta+Shift+N |
| Vue d'ensemble des agents | Meta+Shift+A |

## 6. Accessibilité

- Contraste du texte d'au moins 4.5:1 (WCAG AA) dans les deux thèmes ; on le vérifie dans les tests e2e (axe-core).
- Focus clavier toujours visible (contour `--accent` de 2 px).
- Tous les composants interactifs sont construits sur Radix (rôles ARIA, navigation au clavier).

## 7. Intégration KDE Plasma

- Fichier `.desktop` + icône ; actions rapides dans le menu du lanceur (« Nouvel agent », « Vue d'ensemble »).
- Tray (StatusNotifierItem) avec un badge pour les agents en attente.
- Notifications freedesktop avec des boutons d'action (« Ouvrir », « Répondre plus tard »).
- Plus tard : un runner KRunner pour ouvrir un projet ou un agent depuis Alt+Espace.
