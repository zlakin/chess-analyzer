import type { PositionEvaluation, SrsQuality } from '../../../shared/types'
import { computeMoveEvalDelta } from '../../../shared/engineMath'
import { cpLossToQuality } from './cpLossToQuality'

export interface GradedAttempt {
  correct: boolean
  cpLoss: number
  quality: SrsQuality
}

export function gradeAttempt(
  evalBefore: PositionEvaluation,
  evalAfter: PositionEvaluation,
  attemptedUci: string,
  bestMoveUci: string
): GradedAttempt {
  if (attemptedUci === bestMoveUci || `${attemptedUci}q` === bestMoveUci) {
    return { correct: true, cpLoss: 0, quality: 5 }
  }
  const { cpLoss } = computeMoveEvalDelta(evalBefore, evalAfter, attemptedUci)
  const quality = cpLossToQuality(cpLoss)
  return { correct: quality >= 3, cpLoss, quality }
}
