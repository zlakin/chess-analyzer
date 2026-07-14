import type { TimeControlCategory } from '../../shared/types'

// Chess.com/FIDE convention: a game's effective speed accounts for
// increment via an estimated 40-move game, not just the base clock --
// e.g. '30+180' (30s base, 3-minute increment) plays far slower than its
// tiny base alone suggests. Non-numeric/malformed input falls back to 0
// (the smallest bucket) rather than silently defaulting to 'rapid'.
const ESTIMATED_MOVES_PER_GAME = 40

function effectiveSeconds(timeControl: string): number {
  const [baseRaw, incrementRaw] = timeControl.split('+')
  const base = Number(baseRaw)
  const increment = incrementRaw === undefined ? 0 : Number(incrementRaw)
  const safeBase = Number.isFinite(base) ? base : 0
  const safeIncrement = Number.isFinite(increment) ? increment : 0
  return safeBase + ESTIMATED_MOVES_PER_GAME * safeIncrement
}

export function categorizeTimeControl(timeControl: string): TimeControlCategory {
  if (timeControl.includes('/')) return 'daily'
  const seconds = effectiveSeconds(timeControl)
  if (seconds < 180) return 'bullet'
  if (seconds < 600) return 'blitz'
  return 'rapid'
}

const VALID_CATEGORIES = new Set<string>(['bullet', 'blitz', 'rapid', 'daily'])

// Chess.com's own `time_class` field is authoritative and already matches
// our category names -- prefer it over re-deriving one from the raw
// `timeControl` PGN tag, which some game types (e.g. "Play vs Coach") set
// to a non-numeric placeholder like "-" that no numeric parse can
// categorize correctly. Falls back to the heuristic when time_class is
// missing or unrecognized (e.g. a chess.com API change, or a caller not
// backed by chess.com at all).
export function resolveTimeControlCategory(
  timeClass: string | undefined,
  timeControl: string
): TimeControlCategory {
  if (timeClass && VALID_CATEGORIES.has(timeClass)) {
    return timeClass as TimeControlCategory
  }
  return categorizeTimeControl(timeControl)
}

const CLOCK_PATTERN = /\{\[%clk (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]\}/g

// Returns one entry per %clk annotation found, in the order they appear in
// the PGN text -- chess.com's export places one after every ply, so this
// lines up 1:1 with plies for games that have clock data at all. Returns
// an empty array (not one null per ply) when the PGN has none, so callers
// can tell "no clock data for this game" apart from "clock data exists".
export function parseClockSeconds(pgn: string): number[] {
  return [...pgn.matchAll(CLOCK_PATTERN)].map((match) => {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    const seconds = Number(match[3])
    return hours * 3600 + minutes * 60 + seconds
  })
}

const TIME_PRESSURE_FRACTION = 0.1

export function isTimePressureMove(clockSecondsRemaining: number, baseSeconds: number): boolean {
  if (baseSeconds <= 0) return false
  return clockSecondsRemaining < baseSeconds * TIME_PRESSURE_FRACTION
}

export function baseSecondsFromTimeControl(timeControl: string): number | null {
  if (timeControl.includes('/')) return null
  const base = Number(timeControl.split('+')[0])
  return Number.isFinite(base) ? base : null
}
