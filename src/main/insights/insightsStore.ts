import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  renameSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { GameInsightRecord, ScanMeta } from '../../shared/types'

// Version 2: move classification moved from raw centipawn loss to
// win-probability loss, and the sacrifice signal moved to static exchange
// evaluation, so version-1 mistakes were selected by different rules.
export const CURRENT_SCHEMA_VERSION = 2

// The number of most-recent games a scan fetches -- see
// fetchRecentGames(username, SCAN_GAME_LIMIT) in scanRunner.ts -- and
// therefore the only records isSchemaStale() below can ever expect a
// rescan to rebuild. Defined here rather than in scanRunner.ts because
// scanRunner.ts already imports from this module; the reverse direction
// would create an import cycle. scanRunner.ts imports it back from here so
// there is exactly one definition of the value.
export const SCAN_GAME_LIMIT = 100

function defaultScanMeta(): ScanMeta {
  return { username: null, lastScanTime: null, scannedUrls: [], schemaVersion: CURRENT_SCHEMA_VERSION }
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
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : [],
      // 0 never matches CURRENT_SCHEMA_VERSION, so a pre-versioning
      // scan-meta.json (or a missing/corrupt field) always makes
      // ensureSchemaVersion() below record the current version rather than
      // being trusted as already up to date.
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0
    }
  } catch {
    return defaultScanMeta()
  }
}

// Writes through a temp file and renames, matching srsStore, masteryStore and
// puzzleStatsStore. saveGameRecord() re-saves this file once per newly scanned
// game, so a 100-game scan -- exactly what the version-2 migration forces --
// performs 100 write cycles. A bare writeFileSync opens the destination with
// 'w', which truncates to 0 bytes before writing, so a failure as ordinary as
// a full disk leaves an empty file behind. loadScanMeta() then catches the
// parse failure and hands back defaultScanMeta(), whose `username` is null,
// and ensureUsernameScope() reads null as "first scan ever" and skips the
// games/ wipe -- so relinking to a second chess.com account would silently
// aggregate the first account's cached games into the second account's
// insights, weak openings and mastery queues. Preventing exactly that is the
// guard's entire job, so this file must never be observed half-written.
export function saveScanMeta(patch: Partial<ScanMeta>): ScanMeta {
  const merged = { ...loadScanMeta(), ...patch }
  const path = scanMetaPath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8')
  renameSync(tmpPath, path)
  return merged
}

// Whether a game is scanned is decided solely by its own per-game cache
// file -- not by scan-meta.json's `scannedUrls` ledger -- so a corrupted
// scan-meta.json can't wipe the "already scanned" status of every
// previously-cached game at once. saveScanMeta() is atomic, so it is no longer
// the likely source of such corruption, but the ledger is still the wrong
// thing to trust: it is a single file whose loss would otherwise invalidate
// every game at once, where a per-game file can only ever lose its own game.
export function isGameScanned(gameUrl: string): boolean {
  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return false
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8')) as Partial<GameInsightRecord>
    // A record written before the current analysis rules is real data worth
    // keeping and rendering, but it must not suppress a re-analysis -- the
    // rescan is exactly how it gets rebuilt.
    return (record.schemaVersion ?? 1) >= CURRENT_SCHEMA_VERSION
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

// Deliberately does NOT delete anything. This runs from four read paths
// (getInsightsReport, getMistakeDetail, getMasteryTree, getNodeQueue), so
// the previous "unlink every file in games/" behaviour meant that merely
// opening a tab after a version bump destroyed hours of engine work with no
// warning -- and orphaned every card in srs-state.json, which is keyed by
// `${gameUrl}#${ply}`. Instead, stale records stay readable and keep
// rendering; isGameScanned() reports them as unscanned so the next rescan
// rebuilds them one game at a time, and the UI asks for that rescan.
export function ensureSchemaVersion(): void {
  const meta = loadScanMeta()
  if (meta.schemaVersion === CURRENT_SCHEMA_VERSION) return
  saveScanMeta({ schemaVersion: CURRENT_SCHEMA_VERSION })
}

// Only asks about the newest SCAN_GAME_LIMIT records -- the ones a rescan
// can actually reach (fetchRecentGames(username, SCAN_GAME_LIMIT) in
// scanRunner.ts never refetches anything older). A user who scanned
// SCAN_GAME_LIMIT games long ago and has since played hundreds more would
// otherwise have old records stuck below CURRENT_SCHEMA_VERSION forever,
// with no rescan able to touch them, leaving the "rescan to update" banner
// on permanently. Copies before sorting: loadAllGameRecords() hands back a
// fresh array each call, but .sort() mutates in place and a future caller
// might not expect that. Same O(n) file-read cost as loadAllGameRecords()
// itself -- acceptable because the only caller (getInsightsReport) already
// pays that cost every time it builds a report, so this doesn't add a new
// pass over disk in practice. Not cached: the cache would need
// invalidating on every saveGameRecord(), which is unwarranted complexity
// for a read this cheap.
export function isSchemaStale(): boolean {
  return [...loadAllGameRecords()]
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, SCAN_GAME_LIMIT)
    .some((record) => (record.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION)
}

export function saveGameRecord(record: GameInsightRecord): void {
  mkdirSync(gamesDir(), { recursive: true })
  writeFileSync(gameRecordPath(record.gameUrl), JSON.stringify(record, null, 2), 'utf-8')

  const meta = loadScanMeta()
  if (!meta.scannedUrls.includes(record.gameUrl)) {
    saveScanMeta({ scannedUrls: [...meta.scannedUrls, record.gameUrl] })
  }
}

export function loadGameRecord(gameUrl: string): GameInsightRecord | null {
  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as GameInsightRecord
  } catch {
    return null
  }
}

// The read-side counterpart to isSchemaStale()'s rescan window: user-facing
// aggregates count only records at CURRENT_SCHEMA_VERSION, so the staleness
// banner and the report agree about which records count. isSchemaStale() only
// asks about the newest SCAN_GAME_LIMIT records because that is all a rescan
// can reach, which means a user with more than that many cached games
// permanently holds version-1 records no rescan will ever rebuild -- with the
// banner reading clear. Blending those in is not cosmetic: version-1 `accuracy`
// is a plain arithmetic mean where version 2 is the volatility-weighted /
// harmonic blend, and version-1 `mistakes[]` membership came from centipawn
// tiers where version 2 uses win-percent tiers. Mixing them puts a step in the
// rolling-accuracy chart at the version boundary and quietly skews
// averageAccuracy. Nothing is deleted: the filtered-out records stay on disk so
// a future, wider rescan can still upgrade them.
export function loadCurrentSchemaGameRecords(): GameInsightRecord[] {
  return loadAllGameRecords().filter(
    (record) => (record.schemaVersion ?? 1) >= CURRENT_SCHEMA_VERSION
  )
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
