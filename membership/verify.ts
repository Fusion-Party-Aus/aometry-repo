import { MessageFlags, SlashCommandBuilder } from 'discord.js'
import { Command } from '@/types/discord'
import { getRuntime } from './runtime'

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('verify-membership')
    .setDescription('Check your linked Fusion membership and refresh your member role')
    .setDMPermission(false),
  execute: async ({ interaction, client }) => {
    if (!interaction.isChatInputCommand()) return
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    try {
      const runtime = getRuntime(client)
      if (!runtime || interaction.guildId !== runtime.config.guildId || !interaction.guild) {
        await interaction.editReply('Membership verification is not enabled for this server.')
        return
      }
      const member = await interaction.guild.members.fetch(interaction.user.id)
      const result = await runtime.syncMember(member)
      await interaction.editReply(result === 'eligible'
        ? 'Your Fusion membership is verified and your member role is up to date.'
        : 'No eligible linked membership was found. Sign into Underground CRM using Discord, or connect Discord to your existing CRM account, then try again.')
    } catch {
      await interaction.editReply('Membership verification is unavailable. Please try again later.')
    }
  }
}

export default command
