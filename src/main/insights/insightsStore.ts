import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { GameInsightRecord, ScanMeta } from '../../shared/types'

function defaultScanMeta(): ScanMeta {
  return { username: null, lastScanTime: null, scannedUrls: [] }
}

function gamesDir(): string {
  return join(app.getPath('userData'), 'games')
}

function scanMetaPath(): string {
  return join(app.getPath('userData'), 'scan-meta.json')
}

function gameRecordPath(gameUrl: string): string {
  const hash = createHash('sha1').update(gameUrl).digest('hex')
  return join(gamesDir(), `${hash}.json`)
}

export function loadScanMeta(): ScanMeta {
  const path = scanMetaPath()
  if (!existsSync(path)) return defaultScanMeta()

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScanMeta>
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      lastScanTime: typeof parsed.lastScanTime === 'number' ? parsed.lastScanTime : null,
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : []
    }
  } catch {
    return defaultScanMeta()
  }
}

export function saveScanMeta(patch: Partial<ScanMeta>): ScanMeta {
  const merged = { ...loadScanMeta(), ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(scanMetaPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

// Whether a game is scanned is decided solely by its own per-game cache
// file -- not by scan-meta.json's `scannedUrls` ledger -- so a corrupted or
// truncated scan-meta.json (e.g. from a process killed mid-write, since
// saveScanMeta isn't an atomic write) can't wipe the "already scanned"
// status of every previously-cached game at once.
export function isGameScanned(gameUrl: string): boolean {
  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return false
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
    return true
  } catch {
    return false
  }
}

// The per-game cache has no per-username dimension (it's a flat directory
// keyed only by a hash of the game URL), so switching the tracked
// chess.com username would otherwise silently blend a different account's
// cached games into every future report. Detect the switch and wipe the
// stale cache. Runs at the start of every scan (before any games are
// fetched) so an interrupted first scan for a new username still records
// that username immediately -- otherwise a scan that caches some games and
// then errors/cancels before ever reaching a final saveScanMeta() call
// would leave `username` null, and a later switch to a third username
// would fail to detect the second username's now-stale cache.
export function ensureUsernameScope(username: string): void {
  const meta = loadScanMeta()

  if (meta.username === null) {
    saveScanMeta({ username })
    return
  }

  if (meta.username.toLowerCase() === username.toLowerCase()) return

  const dir = gamesDir()
  if (existsSync(dir)) {
    for (const fileName of readdirSync(dir)) {
      if (fileName.endsWith('.json')) unlinkSync(join(dir, fileName))
    }
  }
  saveScanMeta({ username, lastScanTime: null, scannedUrls: [] })
}

export function saveGameRecord(record: GameInsightRecord): void {
  mkdirSync(gamesDir(), { recursive: true })
  writeFileSync(gameRecordPath(record.gameUrl), JSON.stringify(record, null, 2), 'utf-8')

  const meta = loadScanMeta()
  if (!meta.scannedUrls.includes(record.gameUrl)) {
    saveScanMeta({ scannedUrls: [...meta.scannedUrls, record.gameUrl] })
  }
}

export function loadAllGameRecords(): GameInsightRecord[] {
  const dir = gamesDir()
  if (!existsSync(dir)) return []

  const records: GameInsightRecord[] = []
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith('.json')) continue
    try {
      records.push(JSON.parse(readFileSync(join(dir, fileName), 'utf-8')) as GameInsightRecord)
    } catch {
      // Skip a corrupted per-game cache file rather than failing the whole
      // report -- isGameScanned() also treats it as unscanned, so it will
      // be re-fetched and re-analyzed on the next scan.
    }
  }
  return records
}
