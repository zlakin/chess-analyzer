import type { MoveClassification } from '../../shared/types'

export interface ClassifyMoveInput {
  winPercentLoss: number
  isBestMove: boolean
  isBookMove: boolean
  isPotentialSacrifice: boolean
  evalBeforeMoverCp: number
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

export function classifyMove(input: ClassifyMoveInput): MoveClassification {
  if (input.isBookMove) return 'book'

  if (input.isBestMove) {
    const isCriticalPosition = Math.abs(input.evalBeforeMoverCp) < CRITICAL_POSITION_CP_CEILING

    if (input.isPotentialSacrifice && isCriticalPosition) return 'brilliant'

    if (input.secondBestMoverCp !== null) {
      const gapToSecondBest = input.evalBeforeMoverCp - input.secondBestMoverCp
      if (gapToSecondBest >= GREAT_MOVE_GAP_CP && isCriticalPosition) return 'great'
    }

    return 'best'
  }

  const tier = WIN_PERCENT_LOSS_TIERS.find((t) => input.winPercentLoss <= t.max)
  return tier ? tier.label : 'blunder'
}
