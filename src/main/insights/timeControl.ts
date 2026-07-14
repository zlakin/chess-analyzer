import type { TimeControlCategory } from '../../shared/types'

export function categorizeTimeControl(timeControl: string): TimeControlCategory {
  if (timeControl.includes('/')) return 'daily'
  const baseSeconds = Number(timeControl.split('+')[0])
  if (baseSeconds < 180) return 'bullet'
  if (baseSeconds < 600) return 'blitz'
  return 'rapid'
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
