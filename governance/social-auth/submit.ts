/**
 * Social Auth Submission Command
 * Entry point for the #auth-socmed pipeline: submit -> comment -> approve -> edit -> publish
 *
 * Autocomplete is provided for destinations and policy_links — the host bot must route
 * AutocompleteInteraction events to handleAuthPostAutocomplete() exported below.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { BotClient, Command } from "@/types/discord";
import { DESTINATIONS, POLICY_TAGS, HASHTAGS_CORE, HASHTAGS_BRANCH } from "./types";

const ALL_HASHTAGS = [...HASHTAGS_CORE, ...HASHTAGS_BRANCH, ...POLICY_TAGS.map(p => p.tag)];

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
        .setDescription("Comma-separated destinations, e.g. Facebook,Twitter/X — type to autocomplete")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName("policy_links")
        .setDescription("Policy area to link — type tag name to autocomplete, e.g. ClimateRescue")
        .setRequired(false)
        .setAutocomplete(true)
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
    const policyTagArg = interaction.options.getString("policy_links") ?? '';
    const selfApprove = interaction.options.getBoolean("self-approve") ?? false;

    // Resolve policy tag shorthand → URL(s)
    const resolvedPolicyLinks = policyTagArg
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(token => {
        const match = POLICY_TAGS.find(p => p.tag.toLowerCase() === token.toLowerCase());
        return match ? match.url : (token.startsWith('http') ? token : null);
      })
      .filter((u): u is string => u !== null);

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
        .setValue(resolvedPolicyLinks.join('\n'))
        .setPlaceholder("https://www.fusionparty.org.au/climate_rescue")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
    );

    const hashtagsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("hashtags")
        .setLabel("Hashtags (space separated, no #)")
        .setValue(HASHTAGS_CORE.join(' '))
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

/**
 * Handle autocomplete for /authpost destinations and policy_links options.
 * The host bot must route AutocompleteInteraction with commandName === 'authpost' here.
 */
export async function handleAuthPostAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'destinations') {
    // Support comma-separated multi-value: autocomplete the last token only
    const typed = focused.value;
    const parts = typed.split(',');
    const prefix = parts.slice(0, -1).join(',');
    const current = parts[parts.length - 1].trim().toLowerCase();
    const already = parts.slice(0, -1).map(p => p.trim());

    const suggestions = DESTINATIONS
      .filter(d => !already.includes(d) && d.toLowerCase().includes(current))
      .slice(0, 25)
      .map(d => ({
        name: d,
        value: prefix ? `${prefix},${d}` : d,
      }));

    await interaction.respond(suggestions);

  } else if (focused.name === 'policy_links') {
    const typed = focused.value.toLowerCase();
    const suggestions = POLICY_TAGS
      .filter(p => p.tag.toLowerCase().includes(typed) || p.url.includes(typed))
      .slice(0, 25)
      .map(p => ({ name: `${p.tag} — ${p.url.replace('https://www.fusionparty.org.au/', '')}`, value: p.tag }));

    await interaction.respond(suggestions);
  }
}

export default command;
