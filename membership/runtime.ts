import { Client, Guild, GuildMember, PermissionFlagsBits } from 'discord.js'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { MembershipAccount, MembershipConfig, MembershipVerifier, readConfig } from './service'

/** Isolate failures to one member; never translate an outage into ineligibility. */
export async function reconcileGuild (
  accounts: Iterable<MembershipAccount>, verifier: MembershipVerifier,
  isActive: () => boolean = () => true
): Promise<{ checked: number, failed: number }> {
  let checked = 0
  let failed = 0
  for (const account of accounts) {
    if (!isActive()) break
    try {
      if (await verifier.sync(account) !== 'ignored') checked++
    } catch {
      failed++
    }
  }
  return { checked, failed }
}

function accountFor (member: GuildMember): MembershipAccount {
  return {
    id: member.id, guildId: member.guild.id, bot: member.user.bot,
    hasRole: id => member.roles.cache.has(id),
    addRole: id => member.roles.add(id, 'CRM membership verification'),
    removeRole: id => member.roles.remove(id, 'CRM membership verification')
  }
}

async function validateRole (guild: Guild, config: MembershipConfig): Promise<void> {
  const role = await guild.roles.fetch(config.roleId)
  const me = await guild.members.fetchMe()
  if (!role || role.managed || role.id === guild.id || !role.editable ||
      role.permissions.has(PermissionFlagsBits.Administrator) ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Membership role is missing, unsafe or not manageable')
  }
}

export class MembershipRuntime {
  private timer?: ReturnType<typeof setTimeout>
  private scanning = false
  private stopped = false
  readonly verifier: MembershipVerifier

  constructor (private readonly client: Client, readonly config: MembershipConfig) {
    this.verifier = new MembershipVerifier(config, fetch, () => this.isActive())
  }

  private isActive (): boolean {
    return !this.stopped && existsSync(path.join(__dirname, 'info.json')) &&
      process.env.FUSION_MEMBERSHIP_ENABLED === 'true'
  }

  stop (): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  start (): void {
    // Schedule the next scan only when the previous one completes.
    if (this.timer || this.scanning || !this.isActive()) return
    void this.scan()
  }

  private async scan (): Promise<void> {
    if (!this.isActive()) return
    this.scanning = true
    try {
      const guild = await this.client.guilds.fetch(this.config.guildId)
      await validateRole(guild, this.config)
      const members = await guild.members.fetch()
      const summary = await reconcileGuild(
        Array.from(members.values(), accountFor), this.verifier, () => this.isActive()
      )
      console.info(`Membership sync: ${summary.checked} checked, ${summary.failed} failed`)
    } catch {
      // Do not log raw fetch/Discord errors: they may carry identifiers or credentials.
      console.error('Membership sync failed; check CRM availability, guild intent and role configuration')
    } finally {
      this.scanning = false
      if (this.isActive()) {
        this.timer = setTimeout(() => { this.timer = undefined; void this.scan() }, this.config.intervalMs)
        this.timer.unref()
      }
    }
  }

  async syncMember (member: GuildMember) {
    if (member.guild.id !== this.config.guildId || member.user.bot) return 'ignored' as const
    await validateRole(member.guild, this.config)
    // Refresh stale interaction/join member state before deciding whether a role change is needed.
    const current = await member.guild.members.fetch({ user: member.id, force: true })
    return this.verifier.sync(accountFor(current))
  }
}

// The host may import a module from several command/event files, or reload it.
// A process-wide WeakMap prevents duplicate pollers for the same Discord client.
const shared = globalThis as typeof globalThis & {
  __fusionMembershipRuntimes?: WeakMap<Client, MembershipRuntime>
}
const runtimes = shared.__fusionMembershipRuntimes ??= new WeakMap<Client, MembershipRuntime>()

export function getRuntime (client: Client): MembershipRuntime | null {
  const config = readConfig()
  let runtime = runtimes.get(client)
  if (!config) {
    runtime?.stop()
    runtimes.delete(client)
    return null
  }
  if (runtime && (!(runtime instanceof MembershipRuntime) ||
      JSON.stringify(runtime.config) !== JSON.stringify(config))) {
    runtime.stop()
    runtimes.delete(client)
    runtime = undefined
  }
  if (!runtime) {
    runtime = new MembershipRuntime(client, config)
    runtimes.set(client, runtime)
  }
  runtime.start()
  return runtime
}
