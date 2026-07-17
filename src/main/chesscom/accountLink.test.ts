import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./chessComClient', () => ({
  fetchPlayerProfile: vi.fn()
}))
vi.mock('../settings/settingsStore', () => ({
  saveSettings: vi.fn()
}))

import { fetchPlayerProfile } from './chessComClient'
import { saveSettings } from '../settings/settingsStore'
import {
  startLink,
  verifyLink,
  disconnectAccount,
  __resetPendingChallengeForTests
} from './accountLink'

const fetchPlayerProfileMock = vi.mocked(fetchPlayerProfile)
const saveSettingsMock = vi.mocked(saveSettings)

describe('accountLink', () => {
  beforeEach(() => {
    fetchPlayerProfileMock.mockReset()
    saveSettingsMock.mockReset()
    __resetPendingChallengeForTests()
  })

  describe('startLink', () => {
    it('returns a code once the profile is confirmed to exist', async () => {
      fetchPlayerProfileMock.mockResolvedValue({ username: 'zlakin', location: null })

      const result = await startLink('zlakin')

      expect('code' in result).toBe(true)
      expect((result as { code: string }).code).toMatch(/^CHESSANALYZER-[0-9A-F]{8}$/)
    })

    it('surfaces the error when the profile lookup fails', async () => {
      fetchPlayerProfileMock.mockRejectedValue(new Error('Chess.com user not found'))

      const result = await startLink('nobody')

      expect(result).toEqual({ error: 'Chess.com user not found' })
    })
  })

  describe('verifyLink', () => {
    it('errors when there is no pending challenge', async () => {
      const result = await verifyLink()
      expect(result).toEqual({ error: 'Start linking your account first.' })
    })

    it('links the account once the code shows up in the profile location', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      const started = (await startLink('zlakin')) as { code: string }

      fetchPlayerProfileMock.mockResolvedValueOnce({
        username: 'zlakin',
        location: `hi, my code is ${started.code.toLowerCase()} thanks`
      })

      const result = await verifyLink()

      expect(result).toEqual({
        verified: true,
        username: 'zlakin',
        verifiedAt: expect.any(Number)
      })
      expect(saveSettingsMock).toHaveBeenCalledWith({
        linkedAccount: { username: 'zlakin', verifiedAt: expect.any(Number) }
      })
    })

    it('does not link when the code is not found in the profile location', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      await startLink('zlakin')

      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: 'New York, USA' })

      const result = await verifyLink()

      expect(result).toEqual({
        error: "Didn't find the code in zlakin's profile location yet. Try again."
      })
      expect(saveSettingsMock).not.toHaveBeenCalled()
    })

    it('clears the pending challenge after a successful verify (cannot replay it)', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      const started = (await startLink('zlakin')) as { code: string }
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: started.code })
      await verifyLink()

      const result = await verifyLink()
      expect(result).toEqual({ error: 'Start linking your account first.' })
    })
  })

  describe('disconnectAccount', () => {
    it('clears the linked account', () => {
      disconnectAccount()
      expect(saveSettingsMock).toHaveBeenCalledWith({ linkedAccount: null })
    })
  })
})
