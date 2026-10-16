export interface MembershipConfig {
  crmUrl: URL
  token: string
  guildId: string
  roleId: string
  intervalMs: number
}

const snowflake = /^[0-9]{17,20}$/

export function readConfig (env: NodeJS.ProcessEnv = process.env): MembershipConfig | null {
  if (env.FUSION_MEMBERSHIP_ENABLED !== 'true') return null
  const guildId = env.FUSION_MEMBERSHIP_GUILD_ID || ''
  const roleId = env.FUSION_MEMBERSHIP_ROLE_ID || ''
  const token = env.FUSION_MEMBERSHIP_TOKEN || ''
  if (!snowflake.test(guildId) || !snowflake.test(roleId) || guildId === roleId ||
      token.trim().length < 32 || env.FUSION_MEMBERSHIP_EXCLUSIVE_ROLE !== 'true') {
    throw new Error('Membership configuration is incomplete; require a dedicated role and integration secret')
  }
  let crmUrl: URL
  try {
    crmUrl = new URL(env.FUSION_MEMBERSHIP_CRM_URL || '')
  } catch {
    throw new Error('Membership CRM URL must be an HTTPS base URL')
  }
  if (crmUrl.protocol !== 'https:' || crmUrl.username || crmUrl.password || crmUrl.search || crmUrl.hash) {
    throw new Error('Membership CRM URL must be an HTTPS base URL without credentials, query or fragment')
  }
  if (!crmUrl.pathname.endsWith('/')) crmUrl.pathname += '/'
  const seconds = Number(env.FUSION_MEMBERSHIP_INTERVAL_SECONDS || '300')
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
    throw new Error('Membership interval must be between 60 and 3600 seconds')
  }
  return { crmUrl, token, guildId, roleId, intervalMs: seconds * 1000 }
}

export interface MembershipAccount {
  id: string
  guildId: string
  bot: boolean
  hasRole: (roleId: string) => boolean
  addRole: (roleId: string) => Promise<unknown>
  removeRole: (roleId: string) => Promise<unknown>
}

export type VerificationResult = 'eligible' | 'ineligible' | 'ignored'

/** One eligibility request per account at a time; no membership data is persisted. */
export class MembershipVerifier {
  private readonly pending = new Map<string, Promise<VerificationResult>>()

  constructor (
    readonly config: MembershipConfig,
    private readonly request: typeof fetch = fetch,
    private readonly isActive: () => boolean = () => true
  ) {}

  sync (account: MembershipAccount): Promise<VerificationResult> {
    if (account.guildId !== this.config.guildId || account.bot || !snowflake.test(account.id)) {
      return Promise.resolve('ignored')
    }
    const existing = this.pending.get(account.id)
    if (existing) return existing
    const operation = this.verify(account).finally(() => { this.pending.delete(account.id) })
    this.pending.set(account.id, operation)
    return operation
  }

  private async verify (account: MembershipAccount): Promise<VerificationResult> {
    if (!this.isActive()) throw new Error('Membership integration stopped')
    const url = new URL(`api/integrations/discord/membership/${account.id}/`, this.config.crmUrl)
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${this.config.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`Membership eligibility request failed (${response.status})`)
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('eligible' in payload) ||
        typeof payload.eligible !== 'boolean' || Object.keys(payload).length !== 1) {
      throw new Error('Invalid membership eligibility response')
    }
    if (!this.isActive()) throw new Error('Membership integration stopped')
    if (payload.eligible && !account.hasRole(this.config.roleId)) {
      await account.addRole(this.config.roleId)
    } else if (!payload.eligible && account.hasRole(this.config.roleId)) {
      await account.removeRole(this.config.roleId)
    }
    return payload.eligible ? 'eligible' : 'ineligible'
  }
}
