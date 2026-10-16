import { Events } from 'discord.js'
import { createEvent } from '@/builders/EventBuilder'
import { getRuntime } from './runtime'

export default createEvent(Events.ClientReady, {
  execute: ({ client }) => {
    try {
      getRuntime(client)
    } catch {
      console.error('Membership verification is not configured correctly; review its environment settings')
    }
  }
})
