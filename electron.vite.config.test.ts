import { expect, test } from 'vitest'
import config from './electron.vite.config'

test('configures the main, preload, and renderer builds', () => {
  expect(config).toMatchObject({
    main: expect.any(Object),
    preload: expect.any(Object),
    renderer: expect.any(Object),
  })
})
