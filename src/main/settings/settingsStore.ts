import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../../shared/types'

const DEFAULT_SETTINGS: AppSettings = { chessComUsername: null }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      chessComUsername:
        typeof parsed.chessComUsername === 'string' ? parsed.chessComUsername : null
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...patch }
  const path = getSettingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
