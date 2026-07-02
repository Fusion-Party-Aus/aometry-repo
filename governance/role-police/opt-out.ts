/**
 * "?rejectstates" replacement — grants @opt-out-states to hide all state channels.
 * Thin command wrapper: opt-out-states is a member of the host's own "State" (UNIQUE)
 * roleset, so the Aometry host itself removes any other state role once this is granted —
 * no exclusivity logic needed here. Not unit-tested, per this repo's convention for
 * Discord.js glue.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { BotClient, Command } from "@/types/discord";
import { errorEmbed, successEmbed } from "@/utils/responses";
import { grantRole } from "./interaction";
import { OPT_OUT_STATES_ROLE } from "./config";

// Manual: "?rejectstates may be used anywhere in the server (other than #lobby-and-rules)."
const DISALLOWED_CHANNEL_NAME = "lobby-and-rules";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("rejectstates")
    .setDescription("Hide all state channels by opting out of state roles"),
  execute: (async ({ interaction, client }: { interaction: ChatInputCommandInteraction; client: BotClient }) => {
    if ("channel" in interaction && interaction.channel && "name" in interaction.channel
        && interaction.channel.name === DISALLOWED_CHANNEL_NAME) {
      return interaction.reply({
        embeds: [errorEmbed("Not Here", `This command can't be used in #${DISALLOWED_CHANNEL_NAME}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = interaction.member;
    if (!member || !("roles" in member) || typeof member.roles === "string") {
      return interaction.reply({
        embeds: [errorEmbed("Error", "Could not resolve your guild membership.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await grantRole(member as any, OPT_OUT_STATES_ROLE, "role-police:opt-out", client);

    return interaction.reply({
      embeds: [successEmbed("State Channels Hidden", "You've opted out of state roles — state channels are now hidden.")],
      flags: MessageFlags.Ephemeral,
    });
  }) as Command["execute"],
};

export default command;
