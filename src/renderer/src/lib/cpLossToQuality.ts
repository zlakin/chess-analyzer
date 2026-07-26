import type { SrsQuality } from '../../../shared/types'

export function cpLossToQuality(cpLoss: number): SrsQuality {
  if (cpLoss <= 20) return 5
  if (cpLoss <= 50) return 4
  if (cpLoss <= 100) return 3
  return 1
}
