import { Events } from 'discord.js'
import { createEvent } from '@/builders/EventBuilder'
import { getRuntime } from './runtime'

export default createEvent(Events.GuildMemberAdd, {
  execute: async ({ args: [member], client }) => {
    try {
      const runtime = getRuntime(client)
      if (runtime) await runtime.syncMember(member)
    } catch {
      console.error('Membership join verification failed; it will retry on the next scan')
    }
  }
})
