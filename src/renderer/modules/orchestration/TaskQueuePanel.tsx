import type { FormEvent } from 'react'
import type { TaskQueue } from '../../../shared/ipc'

export function TaskQueuePanel({
  queue,
  update,
}: {
  queue: TaskQueue
  update: (request: Promise<TaskQueue>) => void
}) {
  function saveLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const max = Number(new FormData(event.currentTarget).get('limit'))
    update(window.wu.invoke('settings:setAgentConcurrency', { max }))
  }

  return (
    <section aria-label="File d’attente">
      <h3>File d’attente</h3>
      <form key={queue.limit} onSubmit={saveLimit}>
        <label>
          Agents simultanés
          <input name="limit" type="number" min="1" step="1" defaultValue={queue.limit} required />
        </label>
        <button type="submit">Enregistrer la limite</button>
      </form>
      {queue.pending.length === 0 ? (
        <p>Aucune tâche en attente.</p>
      ) : (
        <ol>
          {queue.pending.map(({ id, title }, index) => (
            <li key={id}>
              {title}{' '}
              {([-1, 1] as const).map((direction) => {
                const target = index + direction
                const available = target >= 0 && target < queue.pending.length
                return (
                  <button
                    type="button"
                    key={direction}
                    aria-disabled={!available}
                    aria-label={`${direction < 0 ? 'Avancer' : 'Reculer'} « ${title} »`}
                    onClick={() => {
                      if (available) update(window.wu.invoke('tasks:reorderQueue', { id, direction }))
                    }}
                  >
                    {direction < 0 ? '↑' : '↓'}
                  </button>
                )
              })}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
