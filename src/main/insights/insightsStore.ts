import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { GameInsightRecord, ScanMeta } from '../../shared/types'

const DEFAULT_SCAN_META: ScanMeta = { username: null, lastScanTime: null, scannedUrls: [] }

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
  if (!existsSync(path)) return { ...DEFAULT_SCAN_META }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScanMeta>
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      lastScanTime: typeof parsed.lastScanTime === 'number' ? parsed.lastScanTime : null,
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : []
    }
  } catch {
    return { ...DEFAULT_SCAN_META }
  }
}

export function saveScanMeta(patch: Partial<ScanMeta>): ScanMeta {
  const merged = { ...loadScanMeta(), ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(scanMetaPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function isGameScanned(gameUrl: string): boolean {
  if (!loadScanMeta().scannedUrls.includes(gameUrl)) return false

  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return false
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
    return true
  } catch {
    return false
  }
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
