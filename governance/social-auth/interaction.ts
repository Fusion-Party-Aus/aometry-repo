/**
 * Social Auth Interaction Handlers
 * Handles vote submissions, edits, gantry transitions, and Fedica publish hand-off
 * for the #auth-socmed pipeline.
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
} from "discord.js";
import { BotClient } from "@/types/discord";
import { SocialAuthDatabaseManager } from "./database";
import {
  GantryState,
  SocialAuthSubmission,
  TimerCalculation,
  VoteType,
  AuthPostStatus,
  Sensitivity,
  SENSITIVITY_CONFIG,
  Destination,
  PostContent,
} from "./types";
import {
  addVote as applyVote,
  calculateDynamicTimer,
  checkSupermajorityBypass,
  checkApprovalThresholdMet,
} from "./calculator";
import { publishToFedica } from "./publish";
import { errorEmbed } from "@/utils/responses";

const GANTRY_COLORS: Record<GantryState, number> = {
  [GantryState.NONE]: 0xffa500,
  [GantryState.NATURAL_APPROVAL]: 0x90ee90,
  [GantryState.VOTED_APPROVAL]: 0xffa500,
  [GantryState.OBJECTION]: 0xff4444,
};

export default async function handleSocialAuthInteraction(
  interaction: Interaction,
  client: BotClient
) {
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("authpost_submit_")) {
      return handleAuthPostModalSubmit(interaction, client);
    }
    if (interaction.customId.startsWith("authpost_edit_")) {
      return handleAuthPostEditSubmit(interaction, client);
    }
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("authpost_approve_")) {
      return handleAuthPostApprove(interaction, client);
    } else if (customId.startsWith("authpost_object_")) {
      return handleAuthPostObject(interaction, client);
    } else if (customId.startsWith("authpost_edit_open_")) {
      return handleAuthPostEditOpen(interaction, client);
    } else if (customId.startsWith("authpost_info_")) {
      return handleAuthPostInfo(interaction, client);
    }
  }
}

/**
 * Handle initial submission from /authpost modal
 */
async function handleAuthPostModalSubmit(
  interaction: ModalSubmitInteraction,
  client: BotClient
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new SocialAuthDatabaseManager();
    const [, , sensitivityRaw, destinationsRaw, selfApproveRaw] = interaction.customId.split("_");
    const sensitivity = (sensitivityRaw as Sensitivity) || Sensitivity.LOW;
    const destinations = decodeURIComponent(destinationsRaw)
      .split(",")
      .map(d => d.trim())
      .filter(Boolean) as Destination[];
    const selfApprove = selfApproveRaw === "true" && SENSITIVITY_CONFIG[sensitivity].allowSelfApprove;

    const commentary = interaction.fields.getTextInputValue("commentary");
    const articleLink = interaction.fields.getTextInputValue("article_link") || null;
    const policyLinks = (interaction.fields.getTextInputValue("policy_links") || "")
      .split("\n").map(l => l.trim()).filter(Boolean);
    const hashtags = (interaction.fields.getTextInputValue("hashtags") || "")
      .split(/\s+/).map(t => t.replace(/^#/, "")).filter(Boolean);
    const notes = interaction.fields.getTextInputValue("notes") || undefined;

    const content: PostContent = { commentary, articleLink, policyLinks, hashtags };

    const approverPoolMemberIds = interaction.guild
      ? interaction.guild.members.cache
          .filter(member => !member.user.bot && member.roles.cache.some(r => r.name === "authnational"))
          .map(member => member.id)
      : [];

    const config = SENSITIVITY_CONFIG[sensitivity];

    const submission = db.createSubmission(
      {
        submitterId: interaction.user.id,
        submitterName: interaction.user.username,
        destinations,
        content,
        sensitivity,
        notes,
        selfApprove,
        approverPool: { name: "authnational", memberIds: approverPoolMemberIds },
        channelId: interaction.channelId ?? interaction.guildId ?? "unknown",
      },
      config.requiredApprovals,
      config.initialTimerMinutes
    );

    const embed = createAuthPostEmbed(submission, submission.timerCalculation);
    const components = createAuthPostButtons(submission.id);

    const channel = interaction.guild?.channels.cache.find(c => c.name === "auth-socmed");
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      return interaction.editReply({
        embeds: [errorEmbed("Channel Not Found", "Could not find #auth-socmed channel")],
      });
    }

    const message = await channel.send({ embeds: [embed], components });
    db.updateSubmission({ ...submission, messageId: message.id, channelId: channel.id });

    return interaction.editReply({
      embeds: [{
        title: "✅ Auth Post Submitted",
        description: `Your request **${submission.id}** has been posted to <#${channel.id}> for approval.\n\nRequired approvals: ${config.requiredApprovals}${selfApprove ? " (self-approved, 1 more needed)" : ""}`,
        color: 0x00aa00,
      }],
    });
  } catch (error) {
    console.error("Auth Post Modal Submit Error:", error);
    return interaction.editReply({ embeds: [errorEmbed("Submission Error", String(error))] });
  }
}

async function handleAuthPostApprove(interaction: ButtonInteraction, _client: BotClient) {
  return castVote(interaction, VoteType.APPROVE);
}

async function handleAuthPostObject(interaction: ButtonInteraction, _client: BotClient) {
  return castVote(interaction, VoteType.OBJECT);
}

async function castVote(interaction: ButtonInteraction, voteType: VoteType) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[2];
    if (!postId) return interaction.editReply({ embeds: [errorEmbed("Error", "Invalid auth post ID")] });

    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });

    if (submission.status !== AuthPostStatus.PENDING) {
      return interaction.editReply({
        embeds: [errorEmbed("Closed", `This auth post is no longer accepting votes (status: ${submission.status}).`)],
      });
    }

    const voteResult = applyVote(submission, interaction.user.id, interaction.user.username, voteType);
    if (voteResult.error) {
      return interaction.editReply({ embeds: [errorEmbed("Vote Error", voteResult.error)] });
    }

    const updatedSubmission = voteResult.submission;
    const latestVote = voteType === VoteType.APPROVE
      ? updatedSubmission.approveVotes[updatedSubmission.approveVotes.length - 1]
      : updatedSubmission.objectVotes[updatedSubmission.objectVotes.length - 1];
    db.addVote(latestVote);
    db.addAuditLog({
      postId,
      eventType: "vote",
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      timestamp: new Date(),
      details: { voteType },
    });
    db.updateSubmission(updatedSubmission);

    // Threshold gate: required-approval count met (independent of the gantry/timer model)
    const thresholdMet = checkApprovalThresholdMet(updatedSubmission.approveVotes, updatedSubmission.requiredApprovals);
    const supermajority = checkSupermajorityBypass(
      updatedSubmission.approveVotes,
      updatedSubmission.approverPool.memberIds.length
    );

    if (voteType === VoteType.APPROVE && (thresholdMet || supermajority)) {
      return resolveApproved(interaction, db, updatedSubmission, supermajority ? "Supermajority bypass" : "Required approvals met");
    }

    const timerCalc = calculateDynamicTimer(
      updatedSubmission.initialTimerMinutes,
      updatedSubmission.approveVotes,
      updatedSubmission.objectVotes,
      updatedSubmission.approverPool.memberIds.length
    );
    const updatedEmbed = createAuthPostEmbed(updatedSubmission, timerCalc);
    const updatedComponents = createAuthPostButtons(postId);

    const message = await getInteractionMessage(interaction, submission.messageId);
    if (message) await message.edit({ embeds: [updatedEmbed], components: updatedComponents });

    return interaction.editReply({
      embeds: [{
        title: voteType === VoteType.APPROVE ? "✅ Approval Recorded" : "⚠️ Objection Recorded",
        description: `Your ${voteType} has been recorded. ${updatedSubmission.approveVotes.length}/${updatedSubmission.requiredApprovals} approvals so far.`,
        color: voteType === VoteType.APPROVE ? 0x00aa00 : 0xff9900,
      }],
    });
  } catch (error) {
    console.error("Auth Post Vote Error:", error);
    return interaction.editReply({ embeds: [errorEmbed("Vote Error", String(error))] });
  }
}

/**
 * Approval threshold met - mark approved, post the publish-pending state, and hand off to Fedica.
 * The publish call itself is fire-and-update: success/failure is reflected back onto the message.
 */
async function resolveApproved(
  interaction: ButtonInteraction,
  db: SocialAuthDatabaseManager,
  submission: SocialAuthSubmission,
  reason: string
) {
  const approved: SocialAuthSubmission = {
    ...submission,
    status: AuthPostStatus.APPROVED,
    resolvedAt: new Date(),
    outcome: "approved",
    outcomeReason: reason,
  };
  db.updateSubmission(approved);
  db.addAuditLog({
    postId: approved.id,
    eventType: "publish_attempt",
    timestamp: new Date(),
    details: { reason },
  });

  const message = await getInteractionMessage(interaction, submission.messageId);
  const pendingEmbed = new EmbedBuilder()
    .setTitle(`✅ ${approved.id} Approved — Publishing to Fedica`)
    .setDescription(`Approved (${reason}). Destinations: ${approved.destinations.join(", ")}`)
    .setColor(0x00aa00);
  if (message) await message.edit({ embeds: [pendingEmbed], components: [] });

  const result = await publishToFedica(approved);

  const published: SocialAuthSubmission = result.success
    ? { ...approved, status: AuthPostStatus.PUBLISHED, publishedAt: new Date(), fedicaPostId: result.fedicaPostId }
    : { ...approved, status: AuthPostStatus.PUBLISH_FAILED, fedicaError: result.error };
  db.updateSubmission(published);
  db.addAuditLog({
    postId: approved.id,
    eventType: result.success ? "publish_success" : "publish_failure",
    timestamp: new Date(),
    details: result,
  });

  const finalEmbed = new EmbedBuilder()
    .setTitle(result.success ? `📤 ${approved.id} Published to Fedica` : `❌ ${approved.id} Fedica Publish Failed`)
    .setDescription(
      result.success
        ? `Destinations: ${approved.destinations.join(", ")}\nFedica post: ${result.fedicaPostId}`
        : `Destinations: ${approved.destinations.join(", ")}\nError: ${result.error}`
    )
    .setColor(result.success ? 0x00aa00 : 0xff4444);
  if (message) await message.edit({ embeds: [finalEmbed], components: [] });

  return interaction.editReply({
    embeds: [{
      title: result.success ? "✅ Approved & Published" : "⚠️ Approved, Publish Failed",
      description: result.success
        ? `**${approved.id}** met its approval threshold and was published to Fedica.`
        : `**${approved.id}** met its approval threshold but the Fedica publish failed: ${result.error}`,
      color: result.success ? 0x00aa00 : 0xff9900,
    }],
  });
}

/**
 * Open the edit modal - prefilled with current content. Submitting it resets votes,
 * since approvers were voting on the previous text.
 */
async function handleAuthPostEditOpen(interaction: ButtonInteraction, _client: BotClient) {
  const postId = interaction.customId.split("_")[3];
  const db = new SocialAuthDatabaseManager();
  const submission = db.getSubmission(postId);
  if (!submission) {
    return interaction.reply({ embeds: [errorEmbed("Not Found", "Auth post not found")], ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`authpost_edit_${postId}`)
    .setTitle(`Edit ${postId}`);

  const commentaryRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("commentary")
      .setLabel("Commentary text")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000)
      .setValue(submission.content.commentary)
  );
  const articleLinkRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("article_link")
      .setLabel("Article link")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(500)
      .setValue(submission.content.articleLink || "")
  );
  const hashtagsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("hashtags")
      .setLabel("Hashtags (space separated, no #)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(300)
      .setValue(submission.content.hashtags.join(" "))
  );
  const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason for edit")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200)
  );

  modal.addComponents(commentaryRow, articleLinkRow, hashtagsRow, reasonRow);
  await interaction.showModal(modal);
}

async function handleAuthPostEditSubmit(interaction: ModalSubmitInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[2];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });

    const newContent: PostContent = {
      commentary: interaction.fields.getTextInputValue("commentary"),
      articleLink: interaction.fields.getTextInputValue("article_link") || null,
      policyLinks: submission.content.policyLinks,
      hashtags: (interaction.fields.getTextInputValue("hashtags") || "")
        .split(/\s+/).map(t => t.replace(/^#/, "")).filter(Boolean),
    };
    const reason = interaction.fields.getTextInputValue("reason") || undefined;

    db.addEdit(postId, {
      editedBy: interaction.user.id,
      editedByName: interaction.user.username,
      timestamp: new Date(),
      previousContent: submission.content,
      newContent,
      reason,
    });

    // Edits invalidate prior votes - approvers were approving the old text. Reset to PENDING.
    const reset: SocialAuthSubmission = {
      ...submission,
      content: newContent,
      status: AuthPostStatus.PENDING,
      approveVotes: [],
      objectVotes: [],
    };
    const retimed = {
      ...reset,
      timerCalculation: calculateDynamicTimer(reset.initialTimerMinutes, [], [], reset.approverPool.memberIds.length),
      expiresAt: new Date(Date.now() + reset.initialTimerMinutes * 60000),
    };
    db.updateSubmission(retimed);

    const updatedEmbed = createAuthPostEmbed(retimed, retimed.timerCalculation);
    const updatedComponents = createAuthPostButtons(postId);
    const message = await getInteractionMessage(interaction as unknown as ButtonInteraction, submission.messageId);
    if (message) await message.edit({ embeds: [updatedEmbed], components: updatedComponents });

    return interaction.editReply({
      embeds: [{
        title: "✏️ Auth Post Edited",
        description: `**${postId}** content was updated${reason ? ` (${reason})` : ""}. Prior votes were cleared - approvers need to re-review.`,
        color: 0x5c9de0,
      }],
    });
  } catch (error) {
    console.error("Auth Post Edit Error:", error);
    return interaction.editReply({ embeds: [errorEmbed("Edit Error", String(error))] });
  }
}

async function handleAuthPostInfo(interaction: ButtonInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[2];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });

    const embed = new EmbedBuilder()
      .setTitle(`Full Details: ${submission.id}`)
      .addFields(
        { name: "Submitter", value: `<@${submission.submitterId}>`, inline: true },
        { name: "Sensitivity", value: submission.sensitivity, inline: true },
        { name: "Destinations", value: submission.destinations.join(", "), inline: false },
        { name: "Commentary", value: submission.content.commentary.substring(0, 1000), inline: false }
      )
      .setColor(0x0099ff);

    if (submission.content.articleLink) {
      embed.addFields({ name: "Article", value: submission.content.articleLink, inline: false });
    }
    if (submission.notes) {
      embed.addFields({ name: "Notes", value: submission.notes, inline: false });
    }
    if (submission.edits.length) {
      embed.addFields({ name: "Edit History", value: `${submission.edits.length} edit(s)`, inline: true });
    }

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Auth Post Info Error:", error);
    return interaction.editReply({ embeds: [errorEmbed("Error", String(error))] });
  }
}

function createAuthPostEmbed(submission: SocialAuthSubmission, timerCalc: TimerCalculation): EmbedBuilder {
  const approveCount = submission.approveVotes.length;
  const objectCount = submission.objectVotes.length;

  const timeRemaining = Math.ceil(((submission.expiresAt?.getTime() ?? Date.now()) - Date.now()) / 60000);
  const gantryColor = GANTRY_COLORS[timerCalc.gantryState] || GANTRY_COLORS[GantryState.VOTED_APPROVAL];

  let gantryStatus = "🟠 Voted Approval";
  if (timerCalc.gantryState === GantryState.NATURAL_APPROVAL) gantryStatus = "🟢 Natural Approval";
  else if (timerCalc.gantryState === GantryState.OBJECTION) gantryStatus = "🔴 Objection Gantry";

  let post = submission.content.commentary;
  if (submission.content.articleLink) post += `\n${submission.content.articleLink}`;
  submission.content.policyLinks.forEach(u => { post += `\nSee our policy here: ${u}`; });
  if (submission.content.hashtags.length) post += `\n${submission.content.hashtags.map(t => `#${t}`).join(" ")}`;

  const embed = new EmbedBuilder()
    .setTitle(`Auth Post: ${submission.id}`)
    .setDescription(post.substring(0, 4000))
    .setColor(gantryColor)
    .addFields(
      { name: "Submitter", value: `<@${submission.submitterId}>`, inline: true },
      { name: "Sensitivity", value: submission.sensitivity, inline: true },
      { name: "Destinations", value: submission.destinations.join(", "), inline: true },
      { name: "Status", value: gantryStatus, inline: true },
      { name: "Time Remaining", value: `${timeRemaining} minutes`, inline: true },
      { name: "Approvals", value: `✅ ${approveCount}/${submission.requiredApprovals} | ❌ ${objectCount}`, inline: true }
    );

  if (submission.notes) {
    embed.addFields({ name: "Reviewer Notes", value: submission.notes.substring(0, 500), inline: false });
  }
  if (submission.edits.length) {
    embed.addFields({ name: "Edits", value: `${submission.edits.length} revision(s) so far`, inline: true });
  }

  return embed;
}

function createAuthPostButtons(postId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_approve_${postId}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`authpost_object_${postId}`).setLabel("❌ Object").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`authpost_edit_open_${postId}`).setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`authpost_info_${postId}`).setLabel("📋 Details").setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function getInteractionMessage(interaction: ButtonInteraction, messageId: string) {
  if (!messageId || !interaction.channel || !("messages" in interaction.channel)) return null;
  try {
    return await interaction.channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

export {
  handleAuthPostModalSubmit,
  handleAuthPostApprove,
  handleAuthPostObject,
  handleAuthPostEditOpen,
  handleAuthPostEditSubmit,
  handleAuthPostInfo,
};
