import { describe, it, expect } from 'vitest'
import { resolveSolvedOutcome, cappedQuality } from './puzzleOutcome'

describe('resolveSolvedOutcome', () => {
  it('is clean when solved on the first attempt with no hint', () => {
    expect(resolveSolvedOutcome(false, false)).toBe('clean')
  })

  it('is retried when solved after a wrong attempt, with no hint', () => {
    expect(resolveSolvedOutcome(true, false)).toBe('retried')
  })

  it('is hinted whenever a hint was used, regardless of prior wrong attempts', () => {
    expect(resolveSolvedOutcome(false, true)).toBe('hinted')
    expect(resolveSolvedOutcome(true, true)).toBe('hinted')
  })
})

describe('cappedQuality', () => {
  it('passes quality through unchanged when no hint was used', () => {
    expect(cappedQuality(5, false)).toBe(5)
    expect(cappedQuality(0, false)).toBe(0)
  })

  it('caps quality at 3 when a hint was used', () => {
    expect(cappedQuality(5, true)).toBe(3)
    expect(cappedQuality(4, true)).toBe(3)
    expect(cappedQuality(3, true)).toBe(3)
  })

  it('leaves an already-low quality untouched when a hint was used', () => {
    expect(cappedQuality(2, true)).toBe(2)
    expect(cappedQuality(0, true)).toBe(0)
  })
})
