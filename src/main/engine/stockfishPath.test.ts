import { describe, it, expect, afterEach, vi } from 'vitest'

let isPackaged = false

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    },
    getAppPath: () => '/dev/app-root'
  }
}))

import { getStockfishBinaryPath } from './stockfishPath'

describe('getStockfishBinaryPath', () => {
  const originalPlatform = process.platform
  const originalResourcesPath = process.resourcesPath

  afterEach(() => {
    isPackaged = false
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
})
