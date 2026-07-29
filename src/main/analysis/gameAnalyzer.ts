import type { AnalyzedPosition, AnalyzedMove, GameAnalysisResult, PositionEvaluation } from '../../shared/types'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import { classifyMove } from './classification'
import { isBookMove } from '../../shared/analysis/openingBook'
import { moveAccuracy, gameAccuracy } from './accuracy'

// A sacrifice is giving up material, not merely moving somewhere defended.
// One and a half pawns is enough to exclude the exchange sac's small change
// while still catching a genuine piece offer.
const SACRIFICE_SEE_THRESHOLD = -150

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

  if (options.isCancelled?.()) return { cancelled: true }

  const sanHistory = positions.map((p) => p.san)
  // Every position needs its fenBefore evaluated once (as the previous
  // move's fenAfter) except the very first, which has no preceding move -
  // this list is exactly those distinct positions, in game order.
  const fens = [positions[0].fenBefore, ...positions.map((p) => p.fenAfter)]

  return new Promise<GameAnalysisResult | { cancelled: true }>((resolve, reject) => {
    const results: Array<PositionEvaluation | undefined> = new Array(fens.length)
    const moves: AnalyzedMove[] = []
    let nextToFlush = 0
    let previousEval: PositionEvaluation | undefined
    let settled = false

    // Guards against acting twice on whichever of cancellation / an error /
    // full completion happens first - later-settling evaluations for
    // positions beyond that point still resolve/reject normally (every
    // dispatched call keeps both handlers attached, so none is ever left
    // unhandled), they just have nothing left to do once this fires.
    function finishOnce(action: () => void): void {
      if (settled) return
      settled = true
      action()
    }

    function tryFlush(): void {
      if (settled) return

      while (results[nextToFlush] !== undefined) {
        if (options.isCancelled?.()) {
          finishOnce(() => resolve({ cancelled: true }))
          return
        }

        const currentEval = results[nextToFlush]!

        if (nextToFlush === 0) {
          // Index 0 is positions[0].fenBefore - the game's starting
          // position, with no move to classify yet. It only seeds
          // previousEval for the first real move's delta below.
          previousEval = currentEval
          nextToFlush++
          continue
        }

        const position = positions[nextToFlush - 1]
        const delta = computeMoveEvalDelta(previousEval!, currentEval, position.moveUci)
        const classification = classifyMove({
          cpLoss: delta.cpLoss,
          isBestMove: delta.isBestMove,
          isBookMove: isBookMove(sanHistory, position.ply),
          isPotentialSacrifice: position.seeCp <= SACRIFICE_SEE_THRESHOLD,
          evalBeforeMoverCp: delta.evalBeforeMoverCp,
          secondBestMoverCp: delta.secondBestMoverCp
        })

        const move: AnalyzedMove = {
          ...position,
          evalBefore: previousEval!,
          evalAfter: currentEval,
          classification,
          accuracy: moveAccuracy(delta)
        }
        moves.push(move)
        options.onMove?.(move)

        previousEval = currentEval
        nextToFlush++
      }

      if (nextToFlush === fens.length) {
        const whiteAccuracy = gameAccuracy(moves.filter((m) => m.color === 'w').map((m) => m.accuracy))
        const blackAccuracy = gameAccuracy(moves.filter((m) => m.color === 'b').map((m) => m.accuracy))
        finishOnce(() => resolve({ moves, whiteAccuracy, blackAccuracy }))
      }
    }

    fens.forEach((fen, i) => {
      engine.evaluatePosition(fen, { depth: options.depth }).then(
        (evaluation) => {
          results[i] = evaluation
          // tryFlush() runs synchronously inside this fulfillment handler,
          // whose own returned promise is discarded by .then() below - if
          // it threw (e.g. options.onMove synchronously throwing because
          // the renderer window was destroyed mid-analysis), that would
          // otherwise become an unhandled rejection and leave `settled`
          // false forever, hanging analyzeGame's outer promise. Route any
          // such throw through the same finishOnce/reject path as a
          // genuine evaluatePosition rejection.
          try {
            tryFlush()
          } catch (err) {
            finishOnce(() => reject(err instanceof Error ? err : new Error(String(err))))
          }
        },
        (err: unknown) => {
          finishOnce(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      )
    })
  })
}
