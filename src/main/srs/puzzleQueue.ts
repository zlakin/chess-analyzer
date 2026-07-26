import type { GameInsightRecord, PuzzleCard, PuzzleQueue, SrsCardState } from '../../shared/types'
import { newCardState } from './sm2'

export function buildPuzzleQueue(
  records: GameInsightRecord[],
  srsState: Record<string, SrsCardState>,
  now: number
): PuzzleQueue {
  const cards: Array<{ card: PuzzleCard; state: SrsCardState }> = []

  for (const record of records) {
    for (const mistake of record.mistakes) {
      const cardId = `${record.gameUrl}#${mistake.ply}`
      const card: PuzzleCard = {
        cardId,
        gameUrl: record.gameUrl,
        ply: mistake.ply,
        fenBefore: mistake.fenBefore,
        playedMoveUci: mistake.playedMoveUci,
        bestMoveUci: mistake.bestMoveUci,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics,
        classification: mistake.classification,
        phase: mistake.phase,
        opponentUsername: record.opponentUsername,
        endTime: record.endTime,
        userColor: record.userColor
      }
      // A card missing from srsState (never reviewed) gets a synthesized
      // default here, in memory only - it is NOT written back to the
      // store. The default's dueDate is always "now" regardless of when
      // it's computed, so recomputing it fresh on every call is
      // equivalent to persisting it eagerly, without needing a write path
      // in what is otherwise a pure read. The store only ever gains an
      // entry for a card once it's actually been reviewed (Task 2, Step 5).
      const state = srsState[cardId] ?? newCardState(cardId, now)
      cards.push({ card, state })
    }
  }

  const due = cards
    .filter(({ state }) => state.dueDate <= now)
    .sort((a, b) => a.state.dueDate - b.state.dueDate)
    .map(({ card }) => card)

  const nextDueAt = cards.length === 0 ? null : Math.min(...cards.map(({ state }) => state.dueDate))

  return { due, nextDueAt }
}
