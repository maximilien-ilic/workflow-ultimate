# Orchestration du développement

Comment on construit ce projet avec des agents, de façon traçable.

## 1. Source de vérité

| Quoi | Où |
|---|---|
| Ce qu'on construit et pourquoi | `docs/SPEC.md` (+ `docs/SPEC-<module>.md` si un module grossit) |
| Décisions d'architecture | `docs/adr/NNNN-titre.md` |
| Plan et ordre | `docs/ROADMAP.md` → milestones GitHub |
| Travail à faire | Issues GitHub (une par ligne de la roadmap) |
| Avancement | GitHub Project « Workflow Ultimate » (Kanban) |
| Règles pour les agents | `AGENTS.md` (lu par Codex) et `CLAUDE.md` (renvoie vers AGENTS.md) |

## 2. Labels

- `type:feat` · `type:fix` · `type:chore` · `type:docs` · `type:spike`
- `area:shell` · `area:projects` · `area:terminals` · `area:agents` · `area:review` · `area:orchestration` · `area:palette`
- `size:S` · `size:M` · `size:L` (une issue `size:L` doit être redécoupée avant de commencer)
- `agent-ready` : critères d'acceptation et vérification précis, donc délégable sans supervision
- `needs-decision` : bloquée sur une décision humaine
- `priority:high` (le reste a la priorité normale)

## 3. Colonnes du Project

`Backlog` → `Ready` (agent-ready et dépendances terminées) → `In progress` → `In review` (PR ouverte) → `Done`

## 4. Contenu d'une issue (modèle `.github/ISSUE_TEMPLATE/task.yml`)

- **Contexte** : lien vers la section de la spec.
- **Critères d'acceptation** : une liste à cocher, chaque critère vérifiable.
- **Vérification** : la commande exacte ou la manipulation à faire.
- **Fichiers probables** : 5 au maximum, sinon on redécoupe.
- **Dépend de** : `#n`.

## 5. Cycle d'une tâche déléguée

```
issue Ready ──► worktree feat/<n>-slug ──► agent (Claude Code ou Codex)
                                               │  TDD : test rouge → vert → refactor
                                               ▼
                    PR « Closes #n » ◄── typecheck + lint + test en local
                           │
                           ▼
          CI verte ──► review (/ponytail-review, puis relecture humaine) ──► squash merge ──► Done
```

1. **Choisir** : la plus ancienne issue `Ready` du milestone en cours, dont les dépendances sont terminées.
2. **Isoler** : un worktree par issue (avec Orca pour l'instant, puis avec l'appli elle-même dès que M2 sera fini).
3. **Briefer l'agent** avec un prompt court : « Implémente #n. Lis AGENTS.md et la section de SPEC.md liée. Suis TDD. Ouvre une PR qui ferme #n. »
4. **Parallélisme** : 3 agents au maximum en même temps, sur des modules différents, pour éviter les conflits.
5. **Review** : `/ponytail-review` sur la PR, puis ta validation. Un agent ne fusionne jamais sa propre PR.
6. **Fin de milestone** : `/ponytail-audit` sur le repo, et la spec est mise à jour si quelque chose a changé.

## 6. Branches et commits

- Branches : `feat/<n>-slug`, `fix/<n>-slug`, `chore/<n>-slug`. `main` est protégée : on y entre uniquement par PR avec la CI verte.
- Commits au format Conventional Commits (`feat(agents): …`), squash au merge.
- Versions en SemVer ; on tague `v0.<milestone>.0` à la fin de chaque milestone.

## 7. Skills utilisés à chaque étape

| Étape | Skill |
|---|---|
| Nouvelle fonctionnalité ou module | `spec-driven-development`, puis `planning-and-task-breakdown` |
| Décision d'architecture | `documentation-and-adrs` |
| Implémentation | `incremental-implementation` + `test-driven-development` + `ponytail` |
| Interface | `frontend-ui-engineering` + `DESIGN.md` |
| Review | `ponytail-review`, `code-review-and-quality` |
| Fin de milestone | `ponytail-audit`, `ponytail-debt` |
| Comprendre le code (une fois qu'il y en a) | `graphify` sur le repo, régénéré à chaque fin de milestone |

## 8. Équipe d'agents : Claude coordinateur + Codex worker

| Rôle | Agent | Où | Fait quoi |
|---|---|---|---|
| Coordinateur | Claude Code | workspace principal | choisit les tickets, rédige les specs des workers, relit les PR, prend les tickets transverses (contrats IPC, architecture, tickets non `agent-ready`) |
| Worker | Codex | un worktree Orca par lot de tickets | tickets `agent-ready` bien délimités : config, outillage, CI, parsers avec tests, composants isolés |

**Lancer un worker Codex** (depuis le coordinateur) :

```
orca orchestration worker-start --agent codex \
  --worktree new-top-level --repo name:workflow-ultimate --name codex-<sujet> \
  --base-branch main \
  --task-title "Tickets #a + #b" --spec-file <spec.md>
```

- Si la base n'est pas encore fusionnée, `--base-branch` pointe sur la branche de la PR dont le lot dépend. Le worker rebase sur `main` après la fusion.
- Orca réveille le coordinateur quand le worker a fini (`worker_done`) ou pose une question (`ask`). On ne fait pas de polling.

**Spec d'un worker** (fichier markdown autonome) : tickets à faire (`gh issue view <n>`), branche de départ, **zone de fichiers autorisée** (et celles interdites parce qu'un autre agent y travaille), contraintes (AGENTS.md, pas d'attribution IA, ne jamais fusionner), et preuves attendues (URL des PR, sortie des commandes, état de la CI).

**Règles de parallélisme** :
- 2 workers Codex au maximum en plus du coordinateur, chacun sur des zones de fichiers séparées, déclarées dans sa spec.
- Fichiers partagés (`package.json`, `package-lock.json`) : le dernier qui fusionne rebase et relance `npm install`.
- Revue croisée : Claude relit les PR de Codex (`/ponytail-review`), et Codex relit celles de Claude (worker de review en lecture seule). La fusion reste humaine.
