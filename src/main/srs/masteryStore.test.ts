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

import { loadMasteryState, saveMasteryState } from './masteryStore'
import type { MasteryState } from './masteryTree'

function state(overrides: MasteryState = {}): MasteryState {
  return { 'fork:1': { cleanStreak: 3, mastered: false }, ...overrides }
}

describe('masteryStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-mastery-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns an empty object when nothing has been saved yet', () => {
    expect(loadMasteryState()).toEqual({})
  })

  it('round-trips saved state', () => {
    saveMasteryState(state())
    expect(loadMasteryState()).toEqual(state())
  })

  it('treats a corrupted store file as empty rather than throwing', () => {
    saveMasteryState(state())
    writeFileSync(join(userDataDir, 'mastery-state.json'), '{not valid json', 'utf-8')

    expect(loadMasteryState()).toEqual({})
  })

  it('overwrites the whole file on save (not a merge)', () => {
    saveMasteryState(state({ 'fork:1': { cleanStreak: 3, mastered: false } }))
    saveMasteryState(state({ 'pin:2': { cleanStreak: 1, mastered: false } }))

    expect(loadMasteryState()).toEqual(state({ 'pin:2': { cleanStreak: 1, mastered: false } }))
  })
})
