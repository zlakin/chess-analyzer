import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { MasteryState } from './masteryTree'

function masteryStatePath(): string {
  return join(app.getPath('userData'), 'mastery-state.json')
}

export function loadMasteryState(): MasteryState {
  const path = masteryStatePath()
  if (!existsSync(path)) return {}

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as MasteryState
  } catch {
    return {}
  }
}

export function saveMasteryState(state: MasteryState): void {
  const path = masteryStatePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}
