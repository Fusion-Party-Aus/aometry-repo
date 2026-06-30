/**
 * Social Auth Submission Command
 * Entry point for the #auth-socmed pipeline: submit -> comment -> approve -> edit -> publish
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { BotClient, Command } from "@/types/discord";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("authpost")
    .setDescription("Submit social media content for #auth-socmed approval")
    .addStringOption(option =>
      option
        .setName("sensitivity")
        .setDescription("Content sensitivity tier - determines required approvals")
        .setRequired(true)
        .addChoices(
          { name: "🟢 Low - reshares, commenting on news, existing Fusion content", value: "low" },
          { name: "🟡 Medium - original posts, responses to breaking news", value: "medium" },
          { name: "🔴 High - controversial topics, reputational risk", value: "high" }
        )
    )
    .addStringOption(option =>
      option
        .setName("destinations")
        .setDescription("Comma-separated destinations, e.g. Facebook,Twitter/X,Instagram")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName("self-approve")
        .setDescription("Self-approve this request (only valid for low sensitivity)")
        .setRequired(false)
    ),

  execute: async ({ interaction: interactionRaw, client }) => {
    const interaction = interactionRaw as ChatInputCommandInteraction;

    const sensitivity = interaction.options.getString("sensitivity", true);
    const destinations = interaction.options.getString("destinations", true);
    const selfApprove = interaction.options.getBoolean("self-approve") ?? false;

    const modal = new ModalBuilder()
      .setCustomId(`authpost_submit_${sensitivity}_${encodeURIComponent(destinations)}_${selfApprove}_${Date.now()}`)
      .setTitle("Auth Post Submission");

    const commentaryRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("commentary")
        .setLabel("Commentary text")
        .setPlaceholder("Your words, not the article's...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
    );

    const articleLinkRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("article_link")
        .setLabel("Article link (optional)")
        .setPlaceholder("https://...")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
    );

    const policyLinksRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("policy_links")
        .setLabel("Policy links (optional, one per line)")
        .setPlaceholder("https://www.fusionparty.org.au/climate_rescue")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
    );

    const hashtagsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("hashtags")
        .setLabel("Hashtags (space separated, no #)")
        .setPlaceholder("auspol fusionparty ClimateRescue")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
    );

    const notesRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Reviewer notes (optional)")
        .setPlaceholder("Scheduling info, known issues, flags for reviewers...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
    );

    modal.addComponents(commentaryRow, articleLinkRow, policyLinksRow, hashtagsRow, notesRow);

    await interaction.showModal(modal);
  },
};

export default command;
