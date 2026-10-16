import { afterEach, describe, expect, it, vi } from 'vitest'
import { reconcileGuild } from './runtime'
import { MembershipVerifier, MembershipAccount, MembershipConfig } from './service'
import { Client, Collection } from 'discord.js'
import { getRuntime } from './runtime'
import join from './join'

const config: MembershipConfig = {
  crmUrl: new URL('https://members.example.org/'), token: 'synthetic-test-secret-only',
  guildId: '123456789012345678', roleId: '234567890123456789', intervalMs: 300000
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

function enable () {
  for (const [key, value] of Object.entries({
    FUSION_MEMBERSHIP_ENABLED: 'true', FUSION_MEMBERSHIP_EXCLUSIVE_ROLE: 'true',
    FUSION_MEMBERSHIP_GUILD_ID: config.guildId, FUSION_MEMBERSHIP_ROLE_ID: config.roleId,
    FUSION_MEMBERSHIP_TOKEN: 'synthetic-test-integration-secret-only',
    FUSION_MEMBERSHIP_CRM_URL: config.crmUrl.toString()
  })) vi.stubEnv(key, value)
}

describe('guild reconciliation', () => {
  it('continues checking other members after an individual failure and reports a summary', async () => {
    const accounts: MembershipAccount[] = ['345678901234567890', '456789012345678901'].map(id => ({
      id, guildId: config.guildId, bot: false, hasRole: () => false,
      addRole: vi.fn(), removeRole: vi.fn()
    }))
    const verifier = new MembershipVerifier(config, async url =>
      url.toString().includes(accounts[0].id)
        ? new Response('Unavailable', { status: 503 })
        : new Response(JSON.stringify({ eligible: true })))
    expect(await reconcileGuild(accounts, verifier)).toEqual({ checked: 1, failed: 1 })
    expect(accounts[1].addRole).toHaveBeenCalledExactlyOnceWith(config.roleId)
  })

  it('keeps one poller, replaces changed configuration, and stops scheduling when disabled', async () => {
    vi.useFakeTimers()
    enable()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const members = { fetchMe: async () => ({ permissions: { has: () => true } }), fetch: vi.fn(async () => new Collection()) }
    const guild = { id: config.guildId, roles: { fetch: async () => ({
      id: config.roleId, editable: true, managed: false, permissions: { has: () => false }
    }) }, members }
    const client = { guilds: { fetch: async () => guild } } as unknown as Client
    const first = getRuntime(client)!
    expect(getRuntime(client)).toBe(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(members.fetch).toHaveBeenCalledTimes(1)
    vi.stubEnv('FUSION_MEMBERSHIP_INTERVAL_SECONDS', '60')
    const replacement = getRuntime(client)!
    expect(replacement).not.toBe(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(members.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60000)
    expect(members.fetch).toHaveBeenCalledTimes(3)
    vi.stubEnv('FUSION_MEMBERSHIP_ENABLED', 'false')
    expect(getRuntime(client)).toBeNull()
    await vi.advanceTimersByTimeAsync(600000)
    expect(members.fetch).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not leak raw errors through the host on join failures', async () => {
    enable()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('FUSION_MEMBERSHIP_CRM_URL', 'https://sensitive-secret@invalid.example.org/')
    await join.execute({ args: [null as never], client: {} as Client })
    expect(errorLog).toHaveBeenCalledExactlyOnceWith('Membership join verification failed; it will retry on the next scan')
  })
})
