import { describe, it, expect, afterEach, vi } from 'vitest'

let isPackaged = false
// The resolved paths in these tests are fictional, so the real existsSync would
// report every one of them missing and getStockfishBinaryPath would throw before
// it could return anything. Faking it lets the assertions below keep testing path
// resolution, and lets the "not installed" test drive the failure deliberately.
let binaryExists = true

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    },
    getAppPath: () => '/dev/app-root'
  }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: () => binaryExists }
})

import { getStockfishBinaryPath } from './stockfishPath'

describe('getStockfishBinaryPath', () => {
  const originalPlatform = process.platform
  const originalResourcesPath = process.resourcesPath

  afterEach(() => {
    isPackaged = false
    binaryExists = true
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true })
  })

  it('resolves relative to the app root in dev (not packaged)', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish')
  })

  it('resolves relative to process.resourcesPath when packaged', () => {
    isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: '/packaged/resources', configurable: true })
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    expect(getStockfishBinaryPath()).toBe('/packaged/resources/vendor/stockfish/stockfish')
  })

  it('uses the .exe suffix on win32', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish.exe')
  })

  it('throws a message pointing at the setup script when the binary is missing', () => {
    isPackaged = false
    binaryExists = false
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    expect(() => getStockfishBinaryPath()).toThrow(/setup:stockfish/)
    expect(() => getStockfishBinaryPath()).toThrow(
      /\/dev\/app-root\/vendor\/stockfish\/stockfish/
    )
  })
})
