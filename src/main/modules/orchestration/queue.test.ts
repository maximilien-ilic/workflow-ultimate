import { expect, it, vi } from 'vitest'
import { createTaskQueue } from './queue'

const job = (id: number) => ({ id, projectId: 'project', title: `Tâche ${id}`, agent: 'codex' as const })

it('remplit trois places puis repart dans l’ordre choisi quand une place se libère', async () => {
  const launched: number[] = []
  let active = 0
  const queue = createTaskQueue(() => active < 3, vi.fn())
  for (const id of [1, 2, 3, 4, 5]) {
    queue.enqueue(job(id), async () => {
      launched.push(id)
      active++
      return true
    })
  }
  await queue.drain()
  expect(launched).toEqual([1, 2, 3])
  expect(queue.list().map(({ id }) => id)).toEqual([4, 5])
  queue.move(5, -1)
  expect(queue.list().map(({ id }) => id)).toEqual([5, 4])
  active--
  await queue.drain()
  expect(launched).toEqual([1, 2, 3, 5])
  expect(queue.list()).toEqual([job(4)])
})

it('refuse les doublons, remet un départ différé en tête et continue après un échec', async () => {
  const changed = vi.fn()
  const queue = createTaskQueue(() => true, changed)
  const first = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('PTY absent'))
  const next = vi.fn().mockResolvedValue(true)
  queue.enqueue(job(1), first)
  queue.enqueue(job(2), next)
  expect(() => queue.enqueue(job(1), next)).toThrow(/déjà/)
  await queue.drain()
  expect(queue.list()).toEqual([job(1), job(2)])
  expect(next).not.toHaveBeenCalled()
  await queue.drain()
  expect(queue.list()).toEqual([])
  expect(changed).toHaveBeenCalledWith('project', 'Tâche 1 : PTY absent')
  expect(next).toHaveBeenCalledOnce()
})
