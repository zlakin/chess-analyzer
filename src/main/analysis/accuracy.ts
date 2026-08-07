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

  // The leading copies of the first window are not padding for its own sake:
  // they make the window count line up exactly with the move count, which is
  // what lets weights[i] belong to moves[i].
  //
  //   windows.length = (windowSize - 2) + (winPercents.length - windowSize + 1)
  //                  = winPercents.length - 1
  //                  = moves.length
  //
  // Do not "simplify" the windowSize - 2 away as an off-by-two; it is load
  // bearing. Because that invariant always holds, the Math.min clamp and the
  // ?? fallback below are unreachable defence-in-depth, not live branches.
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
    // Every weight is clamped to a floor of 0.5 above, and entries is
    // non-empty here, so totalWeight > 0 always holds; the else branch is
    // unreachable defence-in-depth against a future change to that floor.
    const weightedMean =
      totalWeight > 0
        ? entries.reduce((sum, e) => sum + e.accuracy * e.weight, 0) / totalWeight
        : entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length

    // The floor is not a division-by-zero guard (1/0 is Infinity in JS, not a
    // throw): it decides how hard a single zero-accuracy move can pull the
    // whole game down, and it is the dominant term when one exists.
    // moveAccuracy clamps to exactly 0 once the win-percent drop reaches ~80,
    // which "had mate, gets mated" reaches easily, and a floor of 0.01 makes
    // that one move contribute a reciprocal of 100 -- against ~0.19 for the
    // other nineteen moves of a 20-move side. The harmonic term then pins to
    // roughly n/100 no matter what else the player did, collapsing the
    // published blend to half the weighted mean. A floor of 1 is Lichess
    // parity: lila's Maths.harmonicMean is
    // multiplier * a.size / fold(acc + multiplier / max(v, 1)).
    const harmonicMean =
      entries.length / entries.reduce((sum, e) => sum + 1 / Math.max(e.accuracy, 1), 0)

    return clamp((weightedMean + harmonicMean) / 2, 0, 100)
  }

  return { white: forColor('w'), black: forColor('b') }
}
