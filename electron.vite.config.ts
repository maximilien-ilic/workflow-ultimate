import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Le main produit deux fichiers : out/main/index.js et out/main/pty-host.js (processus utilitaire).
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), 'pty-host': resolve('src/pty-host/index.ts') },
      },
    },
  },
  preload: {},
  renderer: { plugins: [react()] },
})
