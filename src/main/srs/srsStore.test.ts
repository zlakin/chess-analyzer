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

import { loadSrsState, saveSrsState } from './srsStore'
import type { SrsCardState } from '../../shared/types'

function card(cardId: string): SrsCardState {
  return { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate: 5000, lastReviewedAt: 1000 }
}

describe('srsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-srs-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns an empty object when nothing has been saved yet', () => {
    expect(loadSrsState()).toEqual({})
  })

  it('round-trips state for multiple cards', () => {
    saveSrsState({ 'game#1': card('game#1'), 'game#2': card('game#2') })
    expect(loadSrsState()).toEqual({ 'game#1': card('game#1'), 'game#2': card('game#2') })
  })

  it('treats a corrupted store file as empty rather than throwing', () => {
    saveSrsState({ 'game#1': card('game#1') })
    writeFileSync(join(userDataDir, 'srs-state.json'), '{not valid json', 'utf-8')

    expect(loadSrsState()).toEqual({})
  })

  it('overwrites the whole file on save (not a merge)', () => {
    saveSrsState({ 'game#1': card('game#1') })
    saveSrsState({ 'game#2': card('game#2') })

    expect(loadSrsState()).toEqual({ 'game#2': card('game#2') })
  })
})
