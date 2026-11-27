import type { DatabaseSync } from 'node:sqlite'
import type { ReviewComment } from '../../../shared/ipc'

type Worktree = { projectId: string; worktreePath: string }
type Draft = Pick<ReviewComment, 'path' | 'line' | 'body'> & { side: NonNullable<ReviewComment['side']> }
const sideLabel = { before: 'avant', after: 'après' }

const singleLine = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')

function agentMessage(comments: ReviewComment[]): string {
  const lines = comments.map(({ path, line, side, body }) => `${singleLine(path)}:${line} (${side ? sideLabel[side] : 'côté indéterminé'}) — ${singleLine(body)}`)
  // Les retours à la ligne restent dans le collage. Une seule touche Entrée soumet le lot.
  return `\x1b[200~Commentaires de revue :\n${lines.join('\n')}\x1b[201~\r`
}

export function createReviewComments(db: DatabaseSync) {
  const sending = new Set<string>()
  const select = db.prepare(`
    SELECT id, path, line, side, body, sent_at AS sentAt FROM review_comments
    WHERE project_id = ? AND worktree_path = ? ORDER BY id
  `)
  const insert = db.prepare(`
    INSERT INTO review_comments (project_id, worktree_path, path, line, side, body) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const list = ({ projectId, worktreePath }: Worktree) => select.all(projectId, worktreePath) as ReviewComment[]
  return {
    list,
    add({ projectId, worktreePath }: Worktree, { path, line, side, body }: Draft) {
      insert.run(projectId, worktreePath, path, line, side, body)
    },
    async send(target: Worktree, write: (message: string) => Promise<void>): Promise<number> {
      const key = JSON.stringify([target.projectId, target.worktreePath])
      if (sending.has(key)) throw new Error('Un envoi est déjà en cours dans ce worktree.')
      const pending = list(target).filter(({ sentAt }) => sentAt === null)
      if (!pending.length) return 0
      const message = agentMessage(pending)
      sending.add(key)
      try {
        await write(message)
        const ids = pending.map(({ id }) => id)
        db.prepare('UPDATE review_comments SET sent_at = ? WHERE id IN (SELECT value FROM json_each(?))')
          .run(Date.now(), JSON.stringify(ids))
        return ids.length
      } finally {
        sending.delete(key)
      }
    },
  }
}
