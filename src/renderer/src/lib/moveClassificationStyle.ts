import {
  Sparkles,
  Star,
  CircleCheck,
  Check,
  BookOpen,
  TriangleAlert,
  CircleAlert,
  CircleX,
  type LucideIcon
} from 'lucide-react'
import type { MoveClassification } from '../../../shared/types'

export interface MoveClassificationStyle {
  label: string
  icon: LucideIcon
  color: string
}

export const MOVE_CLASSIFICATION_STYLE: Record<MoveClassification, MoveClassificationStyle> = {
  book: { label: 'Book', icon: BookOpen, color: 'var(--mq-book)' },
  brilliant: { label: 'Brilliant', icon: Sparkles, color: 'var(--mq-brilliant)' },
  great: { label: 'Great', icon: Star, color: 'var(--mq-great)' },
  best: { label: 'Best', icon: CircleCheck, color: 'var(--mq-best)' },
  excellent: { label: 'Excellent', icon: Check, color: 'var(--mq-excellent)' },
  good: { label: 'Good', icon: Check, color: 'var(--mq-good)' },
  inaccuracy: { label: 'Inaccuracy', icon: TriangleAlert, color: 'var(--mq-inaccuracy)' },
  mistake: { label: 'Mistake', icon: CircleAlert, color: 'var(--mq-mistake)' },
  blunder: { label: 'Blunder', icon: CircleX, color: 'var(--mq-blunder)' }
}
