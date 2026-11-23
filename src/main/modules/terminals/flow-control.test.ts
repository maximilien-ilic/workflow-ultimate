import { describe, expect, it } from 'vitest'
import { FlowControl } from './flow-control'

describe('FlowControl', () => {
  it('met en pause au-delà du seuil haut, reprend sous le seuil bas', () => {
    const flow = new FlowControl(100, 10)
    expect(flow.onData('t', 60)).toBeNull()
    expect(flow.onData('t', 60)).toBe('pause')
    expect(flow.onData('t', 50)).toBeNull() // déjà en pause : pas de second ordre
    expect(flow.onAck('t', 100)).toBeNull() // reste 70 en attente
    expect(flow.onAck('t', 65)).toBe('resume')
    expect(flow.onAck('t', 5)).toBeNull()
  })

  it('suit chaque terminal séparément et oublie un terminal retiré', () => {
    const flow = new FlowControl(100, 10)
    expect(flow.onData('a', 150)).toBe('pause')
    expect(flow.onData('b', 50)).toBeNull()
    flow.forget('a')
    expect(flow.onData('a', 50)).toBeNull()
  })

  it('ignore un accusé de réception plus grand que ce qui est en attente', () => {
    const flow = new FlowControl(100, 10)
    flow.onData('t', 20)
    expect(flow.onAck('t', 1000)).toBeNull()
    expect(flow.onData('t', 99)).toBeNull()
  })
})
