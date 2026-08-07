import type { AnalyzedPosition, AnalyzedMove, GameAnalysisResult, PositionEvaluation } from '../../shared/types'
import { computeMoveEvalDelta, winPercent } from '../../shared/engineMath'
import { classifyMove } from './classification'
import { isBookMove } from '../../shared/analysis/openingBook'
import { moveAccuracy, gameAccuracy } from './accuracy'

export interface EvaluationEngine {
  // Present when the evaluator is an engine pool: the number of engines behind
  // it, and therefore how many evaluations can actually be running at once.
  // analyzeGame never keeps more than this many outstanding (see the dispatch
  // window below). An evaluator without it -- a single engine, or a test fake
  // -- is treated as unbounded, which is the pre-pool behaviour.
  size?: number
  evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number; isCancelled?: () => boolean }
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
    // unhandled), they just have nothing left to do once this fires. Note
    // "dispatched": once this has fired, dispatch() is never called again, so
    // the positions past the settling point are not merely ignored, they are
    // never handed to the engine at all.
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

        // On ply 1 there is no previous move to recapture on, so
        // positions[nextToFlush - 2] is undefined -- that's the mover's very
        // first move of the game, not a missing element, and must not be
        // treated as a recapture. Comparing UCI destination squares (chars
        // 2-4) is what "recapture" means here: this move is a capture that
        // landed on the exact square the opponent's last move landed on.
        // Note it deliberately does NOT require the opponent's move to have
        // been a capture itself -- 3...Nd4 4.Nxd4 counts, even though
        // nothing was taken back -- which is spec 1.4's definition. Both
        // cases share the property the "great" gate cares about: taking the
        // piece the opponent just put there clears the gap to second best
        // without being a feat of calculation.
        const previousPosition = positions[nextToFlush - 2]
        const isRecapture =
          position.isCapture &&
          previousPosition !== undefined &&
          previousPosition.moveUci.slice(2, 4) === position.moveUci.slice(2, 4)

        const classification = classifyMove({
          winPercentLoss: delta.winPercentLoss,
          isBestMove: delta.isBestMove,
          isBookMove: isBookMove(sanHistory, position.ply),
          seeCp: position.seeCp,
          isRecapture,
          legalMoveCount: position.legalMoveCount,
          evalBeforeMoverCp: delta.evalBeforeMoverCp,
          evalAfterMoverCp: delta.evalAfterMoverCp,
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
        const winPercents = fens.map((fen, i) => {
          const evaluation = results[i]
          if (!evaluation || evaluation.lines.length === 0) return 50
          const moverWinPercent = winPercent(evaluation.lines[0])
          // Every evaluation is from the side to move's perspective; the
          // accuracy model needs one consistent (White) perspective.
          return fen.split(' ')[1] === 'w' ? moverWinPercent : 100 - moverWinPercent
        })

        const { white: whiteAccuracy, black: blackAccuracy } = gameAccuracy({
          winPercents,
          moves: moves.map((m) => ({ accuracy: m.accuracy, color: m.color }))
        })
        finishOnce(() => resolve({ moves, whiteAccuracy, blackAccuracy }))
      }
    }

    // Positions go to the engine through a window of at most this many
    // outstanding calls instead of all at once. Handing over every fen up
    // front looks free -- the pool queues them and runs `size` at a time
    // either way -- but it gives away the whole game before the user can
    // cancel: the pool is now shared with the Insights scan, so a cancelled
    // analysis releases its lease instead of stopping the engines (see the
    // comment in handlers.ts), and every queued search would still run to
    // completion on engines the scan needs. Sizing the window to the pool
    // keeps every engine fed -- one outstanding call each -- while leaving
    // nothing beyond that queued to outlive a cancellation.
    const maxOutstanding = Math.max(1, engine.size ?? fens.length)
    let nextToDispatch = 0
    let outstanding = 0

    // The only place work is issued, so cancellation only has to be honoured
    // here. It also settles the run when a cancelled analysis has no reason to
    // keep going: tryFlush() can only notice the cancellation when the next
    // in-order result arrives, and once dispatch has stopped that result may
    // never come, which would leave this promise pending forever.
    function pump(): void {
      if (settled) return
      if (options.isCancelled?.()) {
        finishOnce(() => resolve({ cancelled: true }))
        return
      }
      while (nextToDispatch < fens.length && outstanding < maxOutstanding) {
        dispatch(nextToDispatch++)
      }
    }

    function dispatch(i: number): void {
      outstanding += 1
      engine
        .evaluatePosition(fens[i], { depth: options.depth, isCancelled: options.isCancelled })
        .then(
          (evaluation) => {
            outstanding -= 1
            results[i] = evaluation
            // tryFlush() and pump() run synchronously inside this fulfillment
            // handler, whose own returned promise is discarded by .then()
            // below - if either threw (e.g. options.onMove synchronously
            // throwing because the renderer window was destroyed
            // mid-analysis, or an engine implementation that throws instead
            // of returning a rejected promise), that would otherwise become
            // an unhandled rejection and leave `settled` false forever,
            // hanging analyzeGame's outer promise. Route any such throw
            // through the same finishOnce/reject path as a genuine
            // evaluatePosition rejection.
            try {
              tryFlush()
              pump()
            } catch (err) {
              finishOnce(() => reject(err instanceof Error ? err : new Error(String(err))))
            }
          },
          (err: unknown) => {
            outstanding -= 1
            // While cancelled, a rejection is expected rather than a failure:
            // it is the pool declining to start a search this run no longer
            // wants, or an engine stopped out from under it. Surfacing it as
            // an error would turn the user's own Cancel into an "Analysis
            // failed" message.
            if (options.isCancelled?.()) {
              finishOnce(() => resolve({ cancelled: true }))
              return
            }
            finishOnce(() => reject(err instanceof Error ? err : new Error(String(err))))
          }
        )
    }

    pump()
  })
}
