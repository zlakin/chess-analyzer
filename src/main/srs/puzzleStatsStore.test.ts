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

import { loadPuzzleStats, savePuzzleStats } from './puzzleStatsStore'
import { defaultPuzzleStats } from './puzzleRating'
import type { PuzzleStats } from '../../shared/types'

function stats(overrides: Partial<PuzzleStats> = {}): PuzzleStats {
  return { ...defaultPuzzleStats(), rating: 1250, currentStreak: 3, ...overrides }
}

describe('puzzleStatsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-puzzle-stats-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default stats when nothing has been saved yet', () => {
    expect(loadPuzzleStats()).toEqual(defaultPuzzleStats())
  })

  it('round-trips saved stats', () => {
    savePuzzleStats(stats())
    expect(loadPuzzleStats()).toEqual(stats())
  })

  it('treats a corrupted store file as defaults rather than throwing', () => {
    savePuzzleStats(stats())
    writeFileSync(join(userDataDir, 'puzzle-stats.json'), '{not valid json', 'utf-8')

    expect(loadPuzzleStats()).toEqual(defaultPuzzleStats())
  })

  it('overwrites the whole file on save (not a merge)', () => {
    savePuzzleStats(stats({ rating: 1250 }))
    savePuzzleStats(stats({ rating: 1300 }))

    expect(loadPuzzleStats()).toEqual(stats({ rating: 1300 }))
  })
})
