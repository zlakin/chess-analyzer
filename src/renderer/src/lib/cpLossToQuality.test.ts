import { describe, it, expect } from 'vitest'
import { cpLossToQuality } from './cpLossToQuality'

describe('cpLossToQuality', () => {
  it('is quality 5 at and below the excellent-tier boundary', () => {
    expect(cpLossToQuality(0)).toBe(5)
    expect(cpLossToQuality(19)).toBe(5)
    expect(cpLossToQuality(20)).toBe(5)
  })

  it('is quality 4 just past the excellent boundary, through the good-tier boundary', () => {
    expect(cpLossToQuality(21)).toBe(4)
    expect(cpLossToQuality(49)).toBe(4)
    expect(cpLossToQuality(50)).toBe(4)
  })

  it('is quality 3 just past the good boundary, through the inaccuracy-tier boundary', () => {
    expect(cpLossToQuality(51)).toBe(3)
    expect(cpLossToQuality(99)).toBe(3)
    expect(cpLossToQuality(100)).toBe(3)
  })

  it('is quality 1 past the inaccuracy boundary', () => {
    expect(cpLossToQuality(101)).toBe(1)
    expect(cpLossToQuality(500)).toBe(1)
  })
})
