import type { MoveClassification } from '../../shared/types'

export interface ClassifyMoveInput {
  cpLoss: number
  isBestMove: boolean
  isBookMove: boolean
  isPotentialSacrifice: boolean
  evalBeforeMoverCp: number
  secondBestMoverCp: number | null
}

const CP_LOSS_TIERS: Array<{ max: number; label: MoveClassification }> = [
  { max: 20, label: 'excellent' },
  { max: 50, label: 'good' },
  { max: 100, label: 'inaccuracy' },
  { max: 200, label: 'mistake' },
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

  const tier = CP_LOSS_TIERS.find((t) => input.cpLoss <= t.max)
  return tier ? tier.label : 'blunder'
}
