import type { TacticType } from '../../../shared/types'

export const TACTIC_LABELS: Record<TacticType, string> = {
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discovered_attack: 'Discovered attack',
  back_rank_mate: 'Back-rank mate',
  hung_piece: 'Hung piece'
}
