import { describe, it, expect } from 'vitest'
import { resolvePrefillUsername } from './resolvePrefillUsername'

describe('resolvePrefillUsername', () => {
  it('prefills the saved username when the field is empty', () => {
    expect(resolvePrefillUsername('', 'hikaru')).toBe('hikaru')
  })

  it('does not clobber a username the user already typed (race-condition case)', () => {
    expect(resolvePrefillUsername('magnus', 'hikaru')).toBe('magnus')
  })

  it('leaves an empty field empty when there is no saved username', () => {
    expect(resolvePrefillUsername('', null)).toBe('')
  })

  it('leaves user input untouched when there is no saved username', () => {
    expect(resolvePrefillUsername('magnus', null)).toBe('magnus')
  })
})
