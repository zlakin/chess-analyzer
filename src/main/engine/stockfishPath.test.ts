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
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.resourcesPath = originalResourcesPath
  })

  it('resolves relative to the app root in dev (not packaged)', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'linux' })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish')
  })

  it('resolves relative to process.resourcesPath when packaged', () => {
    isPackaged = true
    process.resourcesPath = '/packaged/resources'
    Object.defineProperty(process, 'platform', { value: 'linux' })

    expect(getStockfishBinaryPath()).toBe('/packaged/resources/vendor/stockfish/stockfish')
  })

  it('uses the .exe suffix on win32', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'win32' })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish.exe')
  })
})
