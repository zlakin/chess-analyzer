import type {
  GameInsightRecord,
  MasteryNodeKey,
  MasteryPuzzleCard,
  MasteryTree,
  SrsCardState,
  TacticType
} from '../../shared/types'
import { newCardState } from './sm2'
import {
  allMasteryNodeKeys,
  currentActiveLevel,
  isUnlocked,
  nodeProgress,
  parseMasteryNodeKey
} from './masteryTree'
import type { MasteryState } from './masteryTree'
import { getBackfillPuzzles } from './backfillPuzzles'

const MIN_NODE_QUEUE_SIZE = 15

function mistakeCardsFor(records: GameInsightRecord[], tactic: TacticType): MasteryPuzzleCard[] {
  const cards: MasteryPuzzleCard[] = []
  for (const record of records) {
    for (const mistake of record.mistakes) {
      const tags = new Set([...mistake.missedTactics, ...mistake.punishedByTactics])
      if (!tags.has(tactic)) continue
      cards.push({
        cardId: `${record.gameUrl}#${mistake.ply}`,
        source: 'mistake',
        fenBefore: mistake.fenBefore,
        bestMoveUci: mistake.bestMoveUci,
        tactic,
        userColor: record.userColor,
        gameUrl: record.gameUrl,
        opponentUsername: record.opponentUsername,
        endTime: record.endTime,
        classification: mistake.classification
      })
    }
  }
  return cards
}

function backfillCardsFor(tactic: TacticType, level: 1 | 2 | 3): MasteryPuzzleCard[] {
  return getBackfillPuzzles(tactic, level).map((puzzle) => ({
    cardId: `backfill:${puzzle.id}`,
    source: 'backfill',
    fenBefore: puzzle.fenBefore,
    bestMoveUci: puzzle.bestMoveUci,
    tactic,
    userColor: puzzle.fenBefore.split(' ')[1] === 'b' ? 'b' : 'w',
    gameUrl: null,
    opponentUsername: null,
    endTime: null,
    classification: 'mistake'
  }))
}

// A node's queue: the user's own real mistakes of that tactic, but only
// while this node is the current frontier for that tactic (a mastered,
// superseded node stops receiving new mistakes - see masteryTree.ts's
// currentActiveLevel), topped up with backfill puzzles until the pool
// reaches a reasonable minimum. Real mistakes are never displaced by
// backfill, only supplemented.
export function buildNodeQueue(
  key: MasteryNodeKey,
  records: GameInsightRecord[],
  masteryState: MasteryState,
  srsState: Record<string, SrsCardState>,
  now: number
): MasteryPuzzleCard[] {
  const { tactic, level } = parseMasteryNodeKey(key)

  const cards: MasteryPuzzleCard[] =
    level === currentActiveLevel(masteryState, tactic) ? mistakeCardsFor(records, tactic) : []

  if (cards.length < MIN_NODE_QUEUE_SIZE) {
    const needed = MIN_NODE_QUEUE_SIZE - cards.length
    // Sort the backfill pool itself by due-date before slicing, so a
    // previously-served (and since solved) puzzle - whose dueDate SM-2
    // pushed out at least a day - rolls out of the prefix and an
    // untouched one (dueDate === now, from newCardState) rolls in. Without
    // this, .slice(0, needed) would always take the same fixed prefix of
    // the 250-item bucket regardless of what the player has already seen.
    const pool = backfillCardsFor(tactic, level)
      .map((card) => ({ card, state: srsState[card.cardId] ?? newCardState(card.cardId, now) }))
      .sort((a, b) => a.state.dueDate - b.state.dueDate)
      .map(({ card }) => card)
    cards.push(...pool.slice(0, needed))
  }

  // Cards already past their SM-2 due-date sort first within the session;
  // not-yet-due cards fill the rest - due-dates prioritize but never gate.
  return cards
    .map((card) => ({ card, state: srsState[card.cardId] ?? newCardState(card.cardId, now) }))
    .sort((a, b) => a.state.dueDate - b.state.dueDate)
    .map(({ card }) => card)
}

export function buildMasteryTree(
  records: GameInsightRecord[],
  masteryState: MasteryState,
  srsState: Record<string, SrsCardState>,
  now: number
): MasteryTree {
  return allMasteryNodeKeys().map((key) => {
    const { tactic, level } = parseMasteryNodeKey(key)
    const progress = nodeProgress(masteryState, key)
    const unlocked = isUnlocked(masteryState, tactic, level)
    const dueCount = unlocked
      ? buildNodeQueue(key, records, masteryState, srsState, now).filter((card) => {
          const cardState = srsState[card.cardId]
          return !cardState || cardState.dueDate <= now
        }).length
      : 0

    return {
      key,
      tactic,
      level,
      unlocked,
      mastered: progress.mastered,
      cleanStreak: progress.cleanStreak,
      dueCount
    }
  })
}
