import { describe, it, expect } from 'vitest'
import { MOVE_CLASSIFICATION_STYLE } from './moveClassificationStyle'
import type { MoveClassification } from '../../../shared/types'

const ALL_CLASSIFICATIONS: MoveClassification[] = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder'
]

describe('MOVE_CLASSIFICATION_STYLE', () => {
  it('defines a label, icon, and color for every move classification', () => {
    for (const classification of ALL_CLASSIFICATIONS) {
      const style = MOVE_CLASSIFICATION_STYLE[classification]
      expect(style, `missing style for "${classification}"`).toBeDefined()
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.icon).toBeDefined()
      expect(style.color).toMatch(/^var\(--mq-[a-z]+\)$/)
    }
  })

  it('gives every classification a distinct color', () => {
    const colors = ALL_CLASSIFICATIONS.map((c) => MOVE_CLASSIFICATION_STYLE[c].color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})
