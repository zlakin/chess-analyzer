import type { AnalyzedPosition, AnalyzedMove, GameAnalysisResult, PositionEvaluation } from '../../shared/types'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import { classifyMove } from './classification'
import { isBookMove } from './openingBook'
import { moveAccuracy, gameAccuracy } from './accuracy'

export interface EvaluationEngine {
  evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number }
  ): Promise<PositionEvaluation>
}

export interface AnalyzeGameOptions {
  depth: number
  onMove?: (move: AnalyzedMove) => void
  isCancelled?: () => boolean
}

export async function analyzeGame(
  positions: AnalyzedPosition[],
  engine: EvaluationEngine,
  options: AnalyzeGameOptions
): Promise<GameAnalysisResult | { cancelled: true }> {
  if (positions.length === 0) {
    return { moves: [], whiteAccuracy: 100, blackAccuracy: 100 }
  }

  const sanHistory = positions.map((p) => p.san)
  const moves: AnalyzedMove[] = []

  if (options.isCancelled?.()) return { cancelled: true }
  let previousEval = await engine.evaluatePosition(positions[0].fenBefore, { depth: options.depth })

  for (const position of positions) {
    if (options.isCancelled?.()) return { cancelled: true }
    const currentEval = await engine.evaluatePosition(position.fenAfter, { depth: options.depth })

    const delta = computeMoveEvalDelta(previousEval, currentEval, position.moveUci)
    const classification = classifyMove({
      cpLoss: delta.cpLoss,
      isBestMove: delta.isBestMove,
      isBookMove: isBookMove(sanHistory, position.ply),
      isPotentialSacrifice: position.isPotentialSacrifice,
      evalBeforeMoverCp: delta.evalBeforeMoverCp,
      secondBestMoverCp: delta.secondBestMoverCp
    })

    const move: AnalyzedMove = {
      ...position,
      evalBefore: previousEval,
      evalAfter: currentEval,
      classification,
      accuracy: moveAccuracy(delta)
    }
    moves.push(move)
    options.onMove?.(move)

    previousEval = currentEval
  }

  const whiteAccuracy = gameAccuracy(moves.filter((m) => m.color === 'w').map((m) => m.accuracy))
  const blackAccuracy = gameAccuracy(moves.filter((m) => m.color === 'b').map((m) => m.accuracy))

  return { moves, whiteAccuracy, blackAccuracy }
}
