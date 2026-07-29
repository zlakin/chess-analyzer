import { cpToWinPercent } from '../../shared/engineMath'
import type { MoveEvalDelta } from '../../shared/engineMath'

export function moveAccuracy(delta: MoveEvalDelta): number {
  const winPercentBefore = cpToWinPercent(delta.evalBeforeMoverCp)
  const winPercentAfter = cpToWinPercent(delta.evalAfterMoverCp)
  const drop = Math.max(0, winPercentBefore - winPercentAfter)
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669
  return Math.min(100, Math.max(0, raw))
}

export interface AccuracyInput {
  /** White-perspective win percent for every position in the game, starting
   *  position first. Length is moves.length + 1. */
  winPercents: number[]
  /** Per-move accuracy and mover colour, in ply order. */
  moves: Array<{ accuracy: number; color: 'w' | 'b' }>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

// Lichess's published game-accuracy method. A plain arithmetic mean -- what
// this used to be -- treats a quiet game with one catastrophe the same as a
// uniformly mediocre one, and reads systematically higher than the number
// chess.com shows for the same game. Two corrections are combined: moves
// made in volatile stretches of the game count for more (the weights), and
// the harmonic mean drags the result toward the worst moves.
export function gameAccuracy(input: AccuracyInput): { white: number; black: number } {
  const { winPercents, moves } = input
  if (moves.length === 0) return { white: 100, black: 100 }

  const windowSize = clamp(Math.floor(winPercents.length / 10), 2, 8)
  const firstWindow = winPercents.slice(0, windowSize)

  const windows: number[][] = []
  for (let i = 0; i < windowSize - 2; i++) windows.push(firstWindow)
  for (let i = 0; i + windowSize <= winPercents.length; i++) {
    windows.push(winPercents.slice(i, i + windowSize))
  }

  const weights = moves.map((_, i) => {
    const window = windows[Math.min(i, windows.length - 1)] ?? firstWindow
    return clamp(standardDeviation(window), 0.5, 12)
  })

  function forColor(color: 'w' | 'b'): number {
    const entries = moves
      .map((move, i) => ({ accuracy: move.accuracy, weight: weights[i], color: move.color }))
      .filter((entry) => entry.color === color)
    if (entries.length === 0) return 100

    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0)
    const weightedMean =
      totalWeight > 0
        ? entries.reduce((sum, e) => sum + e.accuracy * e.weight, 0) / totalWeight
        : entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length

    // Guard the reciprocal: a 0-accuracy move would otherwise divide by zero.
    const harmonicMean =
      entries.length / entries.reduce((sum, e) => sum + 1 / Math.max(e.accuracy, 0.01), 0)

    return clamp((weightedMean + harmonicMean) / 2, 0, 100)
  }

  return { white: forColor('w'), black: forColor('b') }
}
