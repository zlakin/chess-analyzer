import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // Electron's sandboxed preload script loader does not support ES module
  // `import` syntax (it throws "Cannot use import statement outside a
  // module"), even though this project's package.json sets "type": "module"
  // and electron-vite would otherwise emit an ESM (.mjs) preload bundle by
  // default. Force CJS output here so the preload script loads correctly
  // with the default (and recommended) `sandbox: true` webPreferences.
  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
