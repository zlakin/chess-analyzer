import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`)
      return userDataDir
    }
  }
}))

import { loadSettings, saveSettings } from './settingsStore'

describe('settingsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-settings-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default settings when no file exists yet', () => {
    expect(loadSettings()).toEqual({ chessComUsername: null })
  })

  it('returns default settings when the file contains invalid JSON', () => {
    writeFileSync(join(userDataDir, 'settings.json'), '{not valid json', 'utf-8')
    expect(loadSettings()).toEqual({ chessComUsername: null })
  })

  it('round-trips a saved username', () => {
    saveSettings({ chessComUsername: 'hikaru' })
    expect(loadSettings()).toEqual({ chessComUsername: 'hikaru' })
  })

  it('creates the userData directory if it does not exist yet', () => {
    rmSync(userDataDir, { recursive: true, force: true })
    expect(() => saveSettings({ chessComUsername: 'magnus' })).not.toThrow()
    expect(loadSettings()).toEqual({ chessComUsername: 'magnus' })
  })
})
