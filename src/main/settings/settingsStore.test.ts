import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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
    expect(loadSettings()).toEqual({ linkedAccount: null })
  })

  it('returns default settings when the file contains invalid JSON', () => {
    writeFileSync(join(userDataDir, 'settings.json'), '{not valid json', 'utf-8')
    expect(loadSettings()).toEqual({ linkedAccount: null })
  })

  it('round-trips a saved linked account', () => {
    saveSettings({ linkedAccount: { username: 'hikaru', verifiedAt: 1700000000000 } })
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'hikaru', verifiedAt: 1700000000000 }
    })
  })

  it('creates the userData directory if it does not exist yet', () => {
    rmSync(userDataDir, { recursive: true, force: true })
    expect(() =>
      saveSettings({ linkedAccount: { username: 'magnus', verifiedAt: null } })
    ).not.toThrow()
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'magnus', verifiedAt: null }
    })
  })

  it('migrates a legacy chessComUsername string into an unverified linked account', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ chessComUsername: 'zlakin' }),
      'utf-8'
    )
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'zlakin', verifiedAt: null }
    })
  })

  it('persists the migrated shape back to disk so the file only needs migrating once', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ chessComUsername: 'zlakin' }),
      'utf-8'
    )

    loadSettings()

    const onDisk = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(onDisk).toEqual({ linkedAccount: { username: 'zlakin', verifiedAt: null } })
  })

  it('prefers a real linkedAccount over a stale legacy field if somehow both are present', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        chessComUsername: 'old-username',
        linkedAccount: { username: 'new-username', verifiedAt: 1700000000000 }
      }),
      'utf-8'
    )
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'new-username', verifiedAt: 1700000000000 }
    })
  })
})
