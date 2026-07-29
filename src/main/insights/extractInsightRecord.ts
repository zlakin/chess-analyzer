import type {
  ChessComGameSummary,
  GameAnalysisResult,
  GameInsightMistake,
  GameInsightRecord,
  TacticType
} from '../../shared/types'
import { gamePhaseAt } from './phaseHeuristic'
import { detectTactics } from '../../shared/analysis/tacticDetector'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import { CURRENT_SCHEMA_VERSION } from './insightsStore'
import {
  resolveTimeControlCategory,
  parseClockSeconds,
  isTimePressureMove,
  baseSecondsFromTimeControl
} from './timeControl'
import { matchOpeningName } from '../../shared/analysis/openingBook'

const LOSS_RESULTS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned'])

function resultFor(color: 'w' | 'b', game: ChessComGameSummary): 'win' | 'loss' | 'draw' {
  const playerResult = color === 'w' ? game.white.result : game.black.result
  if (playerResult === 'win') return 'win'
  if (LOSS_RESULTS.has(playerResult)) return 'loss'
  return 'draw'
}

function tacticsFor(fen: string, moveUci: string | undefined): TacticType[] {
  return moveUci ? detectTactics(fen, moveUci) : []
}

export function extractInsightRecord(
  game: ChessComGameSummary,
  analysis: GameAnalysisResult,
  username: string
): GameInsightRecord {
  const normalizedUsername = username.trim().toLowerCase()
  const userColor: 'w' | 'b' = game.black.username.toLowerCase() === normalizedUsername ? 'b' : 'w'
  const opponentUsername = userColor === 'w' ? game.black.username : game.white.username

  const clockSeconds = parseClockSeconds(game.pgn)
  const hasClockData = clockSeconds.length === analysis.moves.length
  const baseSeconds = baseSecondsFromTimeControl(game.timeControl)

  const sanHistory = analysis.moves.map((m) => m.san)
  const openingName = matchOpeningName(sanHistory)

  const mistakes: GameInsightMistake[] = analysis.moves
    .filter(
      (move) =>
        move.color === userColor && (move.classification === 'mistake' || move.classification === 'blunder')
    )
    .map((move) => {
      const clockSecondsRemaining = hasClockData ? clockSeconds[move.ply - 1] : null
      const bestMoveUci = move.evalBefore.lines[0]?.moveUci
      const opponentBestMoveUci = move.evalAfter.lines[0]?.moveUci
      const delta = computeMoveEvalDelta(move.evalBefore, move.evalAfter, move.moveUci)

      return {
        ply: move.ply,
        classification: move.classification as 'mistake' | 'blunder',
        phase: gamePhaseAt(move.fenAfter, move.ply),
        cpLoss: delta.cpLoss,
        evalBeforeMoverCp: delta.evalBeforeMoverCp,
        winPercentLoss: delta.winPercentLoss,
        fenBefore: move.fenBefore,
        playedMoveUci: move.moveUci,
        bestMoveUci: bestMoveUci ?? move.moveUci,
        missedTactics: tacticsFor(move.fenBefore, bestMoveUci),
        punishedByTactics: tacticsFor(move.fenAfter, opponentBestMoveUci),
        clockSecondsRemaining,
        isTimePressure:
          clockSecondsRemaining !== null && baseSeconds !== null
            ? isTimePressureMove(clockSecondsRemaining, baseSeconds)
            : false
      }
    })

  return {
    gameUrl: game.url,
    endTime: game.endTime,
    timeControlCategory: resolveTimeControlCategory(game.timeClass, game.timeControl),
    userColor,
    opponentUsername,
    result: resultFor(userColor, game),
    openingName,
    accuracy: userColor === 'w' ? analysis.whiteAccuracy : analysis.blackAccuracy,
    mistakes,
    schemaVersion: CURRENT_SCHEMA_VERSION
  }
}
