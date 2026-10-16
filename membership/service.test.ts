import { describe, expect, it, vi } from 'vitest'
import { MembershipVerifier, readConfig } from './service'

const guildId = '123456789012345678'
const roleId = '234567890123456789'
const discordId = '345678901234567890'
const environment = {
  FUSION_MEMBERSHIP_ENABLED: 'true',
  FUSION_MEMBERSHIP_EXCLUSIVE_ROLE: 'true',
  FUSION_MEMBERSHIP_GUILD_ID: guildId,
  FUSION_MEMBERSHIP_ROLE_ID: roleId,
  FUSION_MEMBERSHIP_CRM_URL: 'https://members.example.org/',
  FUSION_MEMBERSHIP_TOKEN: 'synthetic-test-integration-secret-only'
}

describe('Fusion membership verification', () => {
  it('adds only the configured membership role for an eligible Discord identity', async () => {
    const roles = new Set<string>(['456789012345678901'])
    const verifier = new MembershipVerifier(readConfig(environment)!, async (url, init) => {
      expect(url.toString()).toBe(`https://members.example.org/api/integrations/discord/membership/${discordId}/`)
      expect(init?.headers).toEqual({ Authorization: `Bearer ${environment.FUSION_MEMBERSHIP_TOKEN}` })
      return new Response(JSON.stringify({ eligible: true }))
    })
    const result = await verifier.sync({
      id: discordId, guildId, bot: false,
      hasRole: id => roles.has(id),
      addRole: async id => { roles.add(id) },
      removeRole: async id => { roles.delete(id) }
    })
    expect(result).toBe('eligible')
    expect([...roles]).toEqual(['456789012345678901', roleId])
  })

  it.each([true, false])('repeated eligibility %s is idempotent and leaves unrelated roles alone', async eligible => {
    const roles = new Set(['456789012345678901', ...(eligible ? [roleId] : [])])
    const account = {
      id: discordId, guildId, bot: false, hasRole: (id: string) => roles.has(id),
      addRole: vi.fn(), removeRole: vi.fn()
    }
    const verifier = new MembershipVerifier(readConfig(environment)!, async () =>
      new Response(JSON.stringify({ eligible })))
    await verifier.sync(account)
    await verifier.sync(account)
    expect(account.addRole).not.toHaveBeenCalled()
    expect(account.removeRole).not.toHaveBeenCalled()
    expect(roles.has('456789012345678901')).toBe(true)
  })

  it('removes only the dedicated role after expiry, suspension or unlinking', async () => {
    const roles = new Set([roleId, '456789012345678901'])
    const verifier = new MembershipVerifier(readConfig(environment)!, async () =>
      new Response(JSON.stringify({ eligible: false })))
    await verifier.sync({
      id: discordId, guildId, bot: false, hasRole: id => roles.has(id),
      addRole: async id => { roles.add(id) }, removeRole: async id => { roles.delete(id) }
    })
    expect([...roles]).toEqual(['456789012345678901'])
  })

  it.each([
    () => new Response('Unauthorized', { status: 401 }),
    () => new Response('Unavailable', { status: 503 }),
    () => new Response('{'),
    () => new Response(JSON.stringify({ eligible: 'false' })),
    () => new Response(JSON.stringify({ eligible: false, email: 'private@example.org' })),
    () => { throw new Error('Connection refused') }
  ])('retains current roles on failed or invalid eligibility responses', async response => {
    const account = {
      id: discordId, guildId, bot: false, hasRole: () => true,
      addRole: vi.fn(), removeRole: vi.fn()
    }
    const verifier = new MembershipVerifier(readConfig(environment)!, async () => response())
    await expect(verifier.sync(account)).rejects.toThrow()
    expect(account.addRole).not.toHaveBeenCalled()
    expect(account.removeRole).not.toHaveBeenCalled()
  })

  it.each([
    { guildId: '987654321098765432' }, { bot: true }, { id: '../someone-else' }
  ])('ignores other guilds, bots and malformed identities', async change => {
    const request = vi.fn()
    const verifier = new MembershipVerifier(readConfig(environment)!, request)
    expect(await verifier.sync({
      id: discordId, guildId, bot: false, hasRole: () => false,
      addRole: vi.fn(), removeRole: vi.fn(), ...change
    })).toBe('ignored')
    expect(request).not.toHaveBeenCalled()
  })

  it('coalesces concurrent checks and retries after a temporary failure', async () => {
    let release!: (response: Response) => void
    const request = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    const verifier = new MembershipVerifier(readConfig(environment)!, request)
    const account = {
      id: discordId, guildId, bot: false, hasRole: () => false,
      addRole: vi.fn(), removeRole: vi.fn()
    }
    const first = verifier.sync(account)
    const second = verifier.sync(account)
    expect(first).toBe(second)
    release(new Response('Unavailable', { status: 503 }))
    await expect(first).rejects.toThrow()
    request.mockImplementation(async () => new Response(JSON.stringify({ eligible: true })))
    expect(await verifier.sync(account)).toBe('eligible')
    expect(account.addRole).toHaveBeenCalledExactlyOnceWith(roleId)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('uses a bounded request and never forwards the credential through redirects', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ eligible: false })))
    const verifier = new MembershipVerifier(readConfig(environment)!, request)
    await verifier.sync({
      id: discordId, guildId, bot: false, hasRole: () => false,
      addRole: vi.fn(), removeRole: vi.fn()
    })
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      redirect: 'error', signal: expect.any(AbortSignal)
    }))
  })

  it('does not cache eligibility when the Discord role operation fails', async () => {
    const addRole = vi.fn().mockRejectedValueOnce(new Error('Missing permissions')).mockResolvedValueOnce(undefined)
    const verifier = new MembershipVerifier(readConfig(environment)!, async () =>
      new Response(JSON.stringify({ eligible: true })))
    const account = { id: discordId, guildId, bot: false, hasRole: () => false, addRole, removeRole: vi.fn() }
    await expect(verifier.sync(account)).rejects.toThrow()
    await verifier.sync(account)
    expect(addRole).toHaveBeenCalledTimes(2)
  })

  it('does not mutate roles if the module is disabled while a request is pending', async () => {
    let active = true
    const addRole = vi.fn()
    const verifier = new MembershipVerifier(readConfig(environment)!, async () => {
      active = false
      return new Response(JSON.stringify({ eligible: true }))
    }, () => active)
    await expect(verifier.sync({
      id: discordId, guildId, bot: false, hasRole: () => false,
      addRole, removeRole: vi.fn()
    })).rejects.toThrow()
    expect(addRole).not.toHaveBeenCalled()
  })
})

describe('opt-in configuration', () => {
  it('is disabled by default even if other values are configured', () => {
    expect(readConfig({})).toBeNull()
    expect(readConfig({ ...environment, FUSION_MEMBERSHIP_ENABLED: 'false' })).toBeNull()
  })
  it.each([
    { FUSION_MEMBERSHIP_TOKEN: '' },
    { FUSION_MEMBERSHIP_GUILD_ID: '' },
    { FUSION_MEMBERSHIP_ROLE_ID: guildId },
    { FUSION_MEMBERSHIP_EXCLUSIVE_ROLE: 'false' },
    { FUSION_MEMBERSHIP_CRM_URL: 'http://members.example.org/' },
    { FUSION_MEMBERSHIP_CRM_URL: 'https://secret@members.example.org/' },
    { FUSION_MEMBERSHIP_CRM_URL: 'https://members.example.org/?secret=bad' },
    { FUSION_MEMBERSHIP_CRM_URL: 'not-a-url' },
    { FUSION_MEMBERSHIP_INTERVAL_SECONDS: '1' },
    { FUSION_MEMBERSHIP_INTERVAL_SECONDS: 'NaN' }
  ])('rejects unsafe/incomplete enabled configuration: %j', change => {
    expect(() => readConfig({ ...environment, ...change })).toThrow()
  })
})
