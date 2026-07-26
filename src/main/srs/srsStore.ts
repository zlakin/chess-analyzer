import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SrsCardState } from '../../shared/types'

function srsStatePath(): string {
  return join(app.getPath('userData'), 'srs-state.json')
}

export function loadSrsState(): Record<string, SrsCardState> {
  const path = srsStatePath()
  if (!existsSync(path)) return {}

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, SrsCardState>
  } catch {
    return {}
  }
}

export function saveSrsState(state: Record<string, SrsCardState>): void {
  const path = srsStatePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}
