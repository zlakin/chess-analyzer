import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
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

import {
  loadScanMeta,
  saveScanMeta,
  isGameScanned,
  saveGameRecord,
  loadAllGameRecords,
  ensureUsernameScope,
  ensureSchemaVersion,
  isSchemaStale,
  loadCurrentSchemaGameRecords,
  CURRENT_SCHEMA_VERSION,
  SCAN_GAME_LIMIT
} from './insightsStore'
import { buildInsightsReport } from './reportAggregator'
import type { GameInsightRecord } from '../../shared/types'
import { createHash } from 'node:crypto'

function recordFor(gameUrl: string, endTime = 1000): GameInsightRecord {
  return {
    gameUrl,
    endTime,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    schemaVersion: CURRENT_SCHEMA_VERSION
  }
}

// Writes a game-record JSON file directly to disk, bypassing saveGameRecord
// -- needed to simulate a record shape saveGameRecord itself could never
// produce, e.g. one written before the schemaVersion field existed at all.
function writeRecordJsonDirectly(gameUrl: string, json: unknown): void {
  const dir = join(userDataDir, 'games')
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(gameUrl).digest('hex')
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(json), 'utf-8')
}

describe('insightsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-insights-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({
      username: null,
      lastScanTime: null,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({
      username: 'hikaru',
      lastScanTime: 12345,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('leaves no temp file behind after a successful scan-meta save', () => {
    saveScanMeta({ username: 'hikaru' })

    expect(readdirSync(userDataDir)).toEqual(['scan-meta.json'])
  })

  it('a failed scan-meta write leaves the previous file intact instead of truncating it', () => {
    // The failure that matters in the field is a full disk: opening the
    // destination with 'w' truncates it to 0 bytes and only then fails, and
    // loadScanMeta() reads a 0-byte file as "no username recorded", which
    // makes ensureUsernameScope() skip its games/ wipe. Occupying the temp
    // path with a directory makes the write fail the same way here, and the
    // point of the temp+rename is that the destination is never opened at
    // all, so a failure cannot damage it.
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    mkdirSync(join(userDataDir, 'scan-meta.json.tmp'))

    expect(() => saveScanMeta({ lastScanTime: 99999 })).toThrow()
    expect(loadScanMeta()).toEqual({
      username: 'hikaru',
      lastScanTime: 12345,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('a game is not scanned until its record is saved', () => {
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  it('treats a corrupted per-game cache file as not scanned, even if scan-meta lists it', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    const dir = join(userDataDir, 'games')
    const [fileName] = readdirSync(dir)
    writeFileSync(join(dir, fileName), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
  })

  it('still treats a game as scanned when scan-meta.json is corrupted but its own cache file is intact', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    writeFileSync(join(userDataDir, 'scan-meta.json'), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  describe('ensureUsernameScope', () => {
    it('records the username on the very first scan without clearing anything', () => {
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      ensureUsernameScope('hikaru')

      expect(loadScanMeta().username).toBe('hikaru')
      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('is a no-op when the username is unchanged (case-insensitively)', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))

      ensureUsernameScope('Hikaru')

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('clears all cached game records and resets scan metadata when the tracked username changes', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      saveGameRecord(recordFor('https://www.chess.com/game/live/2'))

      ensureUsernameScope('magnuscarlsen')

      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta()).toEqual({
        username: 'magnuscarlsen',
        lastScanTime: null,
        scannedUrls: [],
        schemaVersion: CURRENT_SCHEMA_VERSION
      })
    })

    it('records the username immediately, before any games are cached, so an interrupted scan is not mistaken for having no tracked user', () => {
      ensureUsernameScope('hikaru')
      // Simulate a scan that cached nothing yet (e.g. it was interrupted
      // before the first game finished analysis) -- username should still
      // be recorded so a later switch to a different username is detected.
      ensureUsernameScope('magnuscarlsen')

      expect(loadScanMeta().username).toBe('magnuscarlsen')
    })
  })

  describe('ensureSchemaVersion', () => {
    it('is a no-op when the stored schema version already matches', () => {
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      ensureSchemaVersion()

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('does not delete cached records when the schema version is stale, but still persists the new version', () => {
      saveGameRecord(recordFor('https://example.com/1'))
      saveScanMeta({ schemaVersion: 1 })

      ensureSchemaVersion()

      expect(loadAllGameRecords()).toHaveLength(1)
      expect(loadScanMeta().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    })
  })

  it('reports a stale schema without changing the stored version', () => {
    // isSchemaStale() answers from the per-game records themselves, not
    // from scan-meta's own schemaVersion bookkeeping field -- so staleness
    // requires an actual stale record, and the assertion below confirms
    // it's a pure read that never touches scan-meta's stored version as a
    // side effect.
    saveGameRecord({ ...recordFor('https://example.com/1a'), schemaVersion: 1 })
    const storedVersionBefore = loadScanMeta().schemaVersion

    expect(isSchemaStale()).toBe(true)
    expect(loadScanMeta().schemaVersion).toBe(storedVersionBefore)
  })

  it('treats a version-2 record as stale, since the accuracy formula changed after it was written', () => {
    // Version 2 -> 3 marks a change with no schema-shaped symptom: the
    // harmonic floor in accuracy.ts moved from 0.01 to 1, which rewrites the
    // persisted `accuracy` of any game holding a near-zero-accuracy move --
    // accuracy.test.ts pins the same 20-move fixture at 30.2619 where it used
    // to be 21.9719. A version-2 record therefore carries a number the app no
    // longer computes, and blending it into averageAccuracy puts a step in the
    // rolling-accuracy chart at exactly the boundary the version has to mark.
    const url = 'https://example.com/version-2'
    saveGameRecord({ ...recordFor(url), schemaVersion: 2 })

    expect(isSchemaStale()).toBe(true)
    expect(isGameScanned(url)).toBe(false)
    expect(loadCurrentSchemaGameRecords()).toEqual([])
    // Nothing is deleted: a rescan upgrades it in place.
    expect(loadAllGameRecords()).toHaveLength(1)
  })

  it('treats a stale record inside the reachable rescan window as stale', () => {
    // A rescan only ever refetches the newest SCAN_GAME_LIMIT games (see
    // fetchRecentGames(username, SCAN_GAME_LIMIT) in scanRunner.ts), so a
    // stale record within that window is exactly the case a rescan is
    // supposed to fix -- the banner must still fire for it. Filling the
    // window exactly to SCAN_GAME_LIMIT records (rather than fewer) proves
    // the windowing logic isn't just trivially passing every record through.
    for (let i = 0; i < SCAN_GAME_LIMIT; i++) {
      saveGameRecord({
        ...recordFor(`https://example.com/window-${i}`, i + 1),
        schemaVersion: i === 40 ? 1 : CURRENT_SCHEMA_VERSION
      })
    }

    expect(isSchemaStale()).toBe(true)
  })

  it('ignores a stale record older than the newest SCAN_GAME_LIMIT games, since a rescan can never reach it', () => {
    // Regression test: isSchemaStale() used to scan every record on disk,
    // so a user who scanned SCAN_GAME_LIMIT games long ago and has since
    // played hundreds more would see the "rescan to update" banner forever
    // -- a rescan only ever refetches the newest SCAN_GAME_LIMIT games, so
    // those older records can never be rebuilt no matter how many times the
    // user rescans. The oldest 10 records (by endTime) are stale; the
    // newest SCAN_GAME_LIMIT are all current, so the reachable window is
    // entirely up to date.
    const totalRecords = SCAN_GAME_LIMIT + 10
    for (let i = 0; i < totalRecords; i++) {
      saveGameRecord({
        ...recordFor(`https://example.com/outside-${i}`, i + 1),
        schemaVersion: i < 10 ? 1 : CURRENT_SCHEMA_VERSION
      })
    }

    expect(isSchemaStale()).toBe(false)
  })

  it('treats a record written under an older schema as unscanned so a rescan rebuilds it', () => {
    const url = 'https://example.com/2'
    saveGameRecord({ ...recordFor(url), schemaVersion: 1 })
    expect(isGameScanned(url)).toBe(false)
  })

  it('treats a record written under the current schema as scanned', () => {
    const url = 'https://example.com/3'
    saveGameRecord(recordFor(url))
    expect(isGameScanned(url)).toBe(true)
  })

  it('treats a record with no schemaVersion field as version 1', () => {
    const url = 'https://example.com/4'
    const { schemaVersion: _omitted, ...legacy } = recordFor(url)
    writeRecordJsonDirectly(url, legacy)
    expect(isGameScanned(url)).toBe(false)
    expect(loadAllGameRecords()).toHaveLength(1)
  })

  it('loadAllGameRecords returns every saved record and skips corrupted files', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    saveGameRecord(recordFor('https://www.chess.com/game/live/2'))
    mkdirSync(join(userDataDir, 'games'), { recursive: true })
    writeFileSync(join(userDataDir, 'games', 'garbage.json'), 'not json', 'utf-8')

    const records = loadAllGameRecords()
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.gameUrl).sort()).toEqual([
      'https://www.chess.com/game/live/1',
      'https://www.chess.com/game/live/2'
    ])
  })

  it('returns an empty array when no games directory exists yet', () => {
    expect(loadAllGameRecords()).toEqual([])
  })

  describe('loadCurrentSchemaGameRecords', () => {
    it('leaves out records written under an older schema without deleting them', () => {
      saveGameRecord({ ...recordFor('https://example.com/old'), schemaVersion: 1 })
      saveGameRecord(recordFor('https://example.com/new'))

      expect(loadCurrentSchemaGameRecords().map((r) => r.gameUrl)).toEqual([
        'https://example.com/new'
      ])
      // Still on disk, so a future wider rescan can upgrade it.
      expect(loadAllGameRecords()).toHaveLength(2)
    })

    it('leaves out a record with no schemaVersion field, which is version 1', () => {
      const url = 'https://example.com/legacy'
      const { schemaVersion: _omitted, ...legacy } = recordFor(url)
      writeRecordJsonDirectly(url, legacy)

      expect(loadCurrentSchemaGameRecords()).toEqual([])
      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('builds the insights report from current-schema records only', () => {
      // A user with more games cached than a rescan can reach keeps version-1
      // records forever while the staleness banner reads clear. Their accuracy
      // came from an arithmetic mean rather than the volatility-weighted /
      // harmonic blend, so averaging the two schemas together reports a number
      // that describes neither.
      saveGameRecord({ ...recordFor('https://example.com/v1-a'), accuracy: 20, schemaVersion: 1 })
      saveGameRecord({ ...recordFor('https://example.com/v1-b'), accuracy: 20, schemaVersion: 1 })
      saveGameRecord({ ...recordFor('https://example.com/v2-a'), accuracy: 80 })
      saveGameRecord({ ...recordFor('https://example.com/v2-b'), accuracy: 90 })

      const report = buildInsightsReport(loadCurrentSchemaGameRecords(), null)
      const overall = report.buckets.find((b) => b.key === 'overall')

      expect(report.gamesScanned).toBe(2)
      expect(overall?.averageAccuracy).toBe(85)
    })

    it('yields an empty report rather than a crash when every cached record is stale', () => {
      saveGameRecord({ ...recordFor('https://example.com/v1-a'), accuracy: 20, schemaVersion: 1 })
      saveGameRecord({ ...recordFor('https://example.com/v1-b'), accuracy: 40, schemaVersion: 1 })

      const report = buildInsightsReport(loadCurrentSchemaGameRecords(), null)
      const overall = report.buckets.find((b) => b.key === 'overall')

      expect(report.gamesScanned).toBe(0)
      expect(report.buckets).toHaveLength(1)
      expect(overall?.averageAccuracy).toBe(0)
      expect(overall?.hasEnoughData).toBe(false)
      expect(overall?.totalMistakes).toBe(0)
    })
  })
})
