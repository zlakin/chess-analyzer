import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Reads the real package.json from disk so this test fails if a future edit
// breaks the electron-builder config shape -- in particular the pacman
// build's maintainer-email requirement, which has previously broken silently
// and was only caught by actually running the build.
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'))

describe('package.json build config', () => {
  it('has a non-empty appId', () => {
    expect(typeof packageJson.build.appId).toBe('string')
    expect(packageJson.build.appId.length).toBeGreaterThan(0)
  })

  it('has a non-empty productName', () => {
    expect(typeof packageJson.build.productName).toBe('string')
    expect(packageJson.build.productName.length).toBeGreaterThan(0)
  })

  it('has a linux maintainer with a name and an angle-bracketed email', () => {
    expect(packageJson.build.linux.maintainer).toMatch(/^.+<\S+@\S+>$/)
  })

  it('includes pacman in the linux build targets', () => {
    expect(packageJson.build.linux.target).toContain('pacman')
  })
})
