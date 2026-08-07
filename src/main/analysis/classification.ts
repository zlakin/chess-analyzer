import type { MoveClassification } from '../../shared/types'

export interface ClassifyMoveInput {
  winPercentLoss: number
  isBestMove: boolean
  isBookMove: boolean
  seeCp: number
  isRecapture: boolean
  legalMoveCount: number
  evalBeforeMoverCp: number
  evalAfterMoverCp: number
  secondBestMoverCp: number | null
}

// Tiers are in win percent lost, not centipawns. These are the previous
// centipawn boundaries (20/50/100/200) converted at an evaluation of 0, so
// balanced positions classify exactly as before -- what changes is decided
// positions and mate sequences, where a centipawn delta stopped meaning
// anything. A +2000 -> +1500 move used to be a "blunder" that scored 98.5%
// accurate at the same time.
const WIN_PERCENT_LOSS_TIERS: Array<{ max: number; label: MoveClassification }> = [
  { max: 2, label: 'excellent' },
  { max: 5, label: 'good' },
  { max: 10, label: 'inaccuracy' },
  { max: 20, label: 'mistake' },
  { max: Infinity, label: 'blunder' }
]

const CRITICAL_POSITION_CP_CEILING = 600
const GREAT_MOVE_GAP_CP = 150
// A sacrifice is giving up material, not merely moving somewhere defended.
// One and a half pawns is enough to exclude the exchange sac's small change
// while still catching a genuine piece offer.
const SACRIFICE_SEE_THRESHOLD = -150
// A sacrifice is only brilliant if declining it was meaningfully worse. If a
// quiet move holds the position just as well, the sacrifice is a good move,
// not a brilliant one.
const BRILLIANT_NECESSITY_GAP_CP = 100
// ...and only if it actually works: the position must not collapse after it.
const BRILLIANT_MIN_EVAL_AFTER_CP = -50

export function classifyMove(input: ClassifyMoveInput): MoveClassification {
  if (input.isBookMove) return 'book'

  if (input.isBestMove) {
    const isCriticalPosition = Math.abs(input.evalBeforeMoverCp) < CRITICAL_POSITION_CP_CEILING

    if (
      input.seeCp <= SACRIFICE_SEE_THRESHOLD &&
      isCriticalPosition &&
      input.evalAfterMoverCp >= BRILLIANT_MIN_EVAL_AFTER_CP &&
      input.secondBestMoverCp !== null &&
      input.evalBeforeMoverCp - input.secondBestMoverCp >= BRILLIANT_NECESSITY_GAP_CP
    ) {
      return 'brilliant'
    }

    // A recapture clears the second-best gap trivially, and a forced move has
    // no alternative to be better than -- neither is a feat of calculation.
    if (input.secondBestMoverCp !== null && !input.isRecapture && input.legalMoveCount > 1) {
      const gapToSecondBest = input.evalBeforeMoverCp - input.secondBestMoverCp
      if (gapToSecondBest >= GREAT_MOVE_GAP_CP && isCriticalPosition) return 'great'
    }

    return 'best'
  }

  // Strictly less than, matching spec 1.2's table ("< 2 excellent", "< 5
  // good", ...): a loss of exactly 2 is a "good" move, not an "excellent"
  // one. winPercentLoss is a difference of two logistic outputs and will
  // not realistically land on an exact integer, so this is about agreeing
  // with the spec rather than about observable behaviour.
  const tier = WIN_PERCENT_LOSS_TIERS.find((t) => input.winPercentLoss < t.max)
  return tier ? tier.label : 'blunder'
}
