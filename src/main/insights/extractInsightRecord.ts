import type {
  ChessComGameSummary,
  GameAnalysisResult,
  GameInsightMistake,
  GameInsightRecord
} from '../../shared/types'
import { gamePhaseAt } from './phaseHeuristic'
import { isHungPieceBlunder } from './hungPieceDetector'
import {
  resolveTimeControlCategory,
  parseClockSeconds,
  isTimePressureMove,
  baseSecondsFromTimeControl
} from './timeControl'
import { matchOpeningName } from '../analysis/openingBook'

const LOSS_RESULTS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned'])

function resultFor(color: 'w' | 'b', game: ChessComGameSummary): 'win' | 'loss' | 'draw' {
  const playerResult = color === 'w' ? game.white.result : game.black.result
  if (playerResult === 'win') return 'win'
  if (LOSS_RESULTS.has(playerResult)) return 'loss'
  return 'draw'
}

export function extractInsightRecord(
  game: ChessComGameSummary,
  analysis: GameAnalysisResult,
  username: string
): GameInsightRecord {
  const normalizedUsername = username.trim().toLowerCase()
  const userColor: 'w' | 'b' = game.black.username.toLowerCase() === normalizedUsername ? 'b' : 'w'

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
      return {
        ply: move.ply,
        classification: move.classification as 'mistake' | 'blunder',
        phase: gamePhaseAt(move.fenAfter, move.ply),
        isHungPiece: isHungPieceBlunder(move.fenAfter, move.evalAfter.lines[0]),
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
    result: resultFor(userColor, game),
    openingName,
    accuracy: userColor === 'w' ? analysis.whiteAccuracy : analysis.blackAccuracy,
    mistakes
  }
}
