import backfillData from './backfillPuzzles.json'
import type { MasteryLevel, TacticType } from '../../shared/types'
import { masteryNodeKey } from './masteryTree'

export interface BackfillPuzzle {
  id: string
  fenBefore: string
  bestMoveUci: string
  rating: number
}

const DATA = backfillData as Record<string, BackfillPuzzle[]>

export function getBackfillPuzzles(tactic: TacticType, level: MasteryLevel): BackfillPuzzle[] {
  return DATA[masteryNodeKey(tactic, level)] ?? []
}
