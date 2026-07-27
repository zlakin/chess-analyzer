import type {
  MasteryLevel,
  MasteryNodeKey,
  MasteryNodeProgress,
  PuzzleOutcome,
  TacticType
} from '../../shared/types'
import { TACTIC_TYPES } from '../../shared/types'

export const MASTERY_LEVELS: MasteryLevel[] = [1, 2, 3]
export const MASTERY_STREAK_TO_MASTER = 5

export type MasteryState = Record<MasteryNodeKey, MasteryNodeProgress>

export function masteryNodeKey(tactic: TacticType, level: MasteryLevel): MasteryNodeKey {
  return `${tactic}:${level}`
}

export function parseMasteryNodeKey(key: MasteryNodeKey): { tactic: TacticType; level: MasteryLevel } {
  const [tactic, levelStr] = key.split(':')
  return { tactic: tactic as TacticType, level: Number(levelStr) as MasteryLevel }
}

export function allMasteryNodeKeys(): MasteryNodeKey[] {
  const keys: MasteryNodeKey[] = []
  for (const tactic of TACTIC_TYPES) {
    for (const level of MASTERY_LEVELS) keys.push(masteryNodeKey(tactic, level))
  }
  return keys
}

export function defaultMasteryProgress(): MasteryNodeProgress {
  return { cleanStreak: 0, mastered: false }
}

export function nodeProgress(state: MasteryState, key: MasteryNodeKey): MasteryNodeProgress {
  return state[key] ?? defaultMasteryProgress()
}

export function isUnlocked(state: MasteryState, tactic: TacticType, level: MasteryLevel): boolean {
  if (level === 1) return true
  const priorLevel = (level - 1) as MasteryLevel
  return nodeProgress(state, masteryNodeKey(tactic, priorLevel)).mastered
}

// The lowest not-yet-mastered level for a tactic - where a *new* real
// mistake of that tactic gets assigned. Once all three levels are
// mastered, new mistakes keep flowing into level 3 (there's nowhere
// further to progress to).
export function currentActiveLevel(state: MasteryState, tactic: TacticType): MasteryLevel {
  for (const level of MASTERY_LEVELS) {
    if (!nodeProgress(state, masteryNodeKey(tactic, level)).mastered) return level
  }
  return 3
}

// A clean solve extends the streak (and masters the node once it reaches
// the threshold, permanently - mastered never reverts to false even if a
// later review on the same node isn't clean). Anything else (retried,
// hinted, gaveUp) resets the streak to 0 without touching mastered.
export function nextMasteryProgress(
  current: MasteryNodeProgress,
  outcome: PuzzleOutcome
): MasteryNodeProgress {
  if (outcome !== 'clean') {
    return { ...current, cleanStreak: 0 }
  }
  const cleanStreak = current.cleanStreak + 1
  return {
    cleanStreak,
    mastered: current.mastered || cleanStreak >= MASTERY_STREAK_TO_MASTER
  }
}
