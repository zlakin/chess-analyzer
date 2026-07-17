import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, LinkedAccount } from '../../shared/types'

const DEFAULT_SETTINGS: AppSettings = { linkedAccount: null }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed.linkedAccount !== undefined) {
      const linkedAccount = parsed.linkedAccount as Partial<LinkedAccount> | null
      if (linkedAccount && typeof linkedAccount.username === 'string') {
        return {
          linkedAccount: {
            username: linkedAccount.username,
            verifiedAt: typeof linkedAccount.verifiedAt === 'number' ? linkedAccount.verifiedAt : null
          }
        }
      }
      return { linkedAccount: null }
    }

    // Legacy pre-account-linking shape: a plain saved username with no proof
    // of ownership. Migrate it into an unverified linked account and persist
    // the new shape immediately, so this file only ever needs migrating once.
    if (typeof parsed.chessComUsername === 'string') {
      const migrated: AppSettings = {
        linkedAccount: { username: parsed.chessComUsername, verifiedAt: null }
      }
      writeFileSync(path, JSON.stringify(migrated, null, 2), 'utf-8')
      return migrated
    }

    return { ...DEFAULT_SETTINGS }
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
