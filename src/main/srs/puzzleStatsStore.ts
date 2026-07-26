import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { PuzzleStats } from '../../shared/types'
import { defaultPuzzleStats } from './puzzleRating'

function puzzleStatsPath(): string {
  return join(app.getPath('userData'), 'puzzle-stats.json')
}

export function loadPuzzleStats(): PuzzleStats {
  const path = puzzleStatsPath()
  if (!existsSync(path)) return defaultPuzzleStats()

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PuzzleStats
  } catch {
    return defaultPuzzleStats()
  }
}

export function savePuzzleStats(stats: PuzzleStats): void {
  const path = puzzleStatsPath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(stats, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}
