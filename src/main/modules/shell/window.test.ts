import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
const { devRendererUrl } = await import('./window')

describe('devRendererUrl', () => {
  it.each([
    ['http://localhost:5173/', 'http://localhost:5173/'],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'],
    ['http://[::1]:5173/', 'http://[::1]:5173/'],
  ])('accepte un serveur Vite local : %s', (url, expected) => {
    expect(devRendererUrl({ ELECTRON_RENDERER_URL: url }, false)).toBe(expected)
  })

  it.each([
    ['https://evil.example/'],
    ['http://localhost.evil.example/'],
    ['file:///tmp/evil.html'],
    ['pas une url'],
  ])('refuse une URL qui ne vient pas d’un serveur local : %s', (url) => {
    expect(devRendererUrl({ ELECTRON_RENDERER_URL: url }, false)).toBeUndefined()
  })

  it('ignore la variable dans un build packagé', () => {
    expect(devRendererUrl({ ELECTRON_RENDERER_URL: 'http://localhost:5173/' }, true)).toBeUndefined()
  })
})
