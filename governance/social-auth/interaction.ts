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
import { publishToFedica, parseScheduleFromText, validatePostForDestinations } from "./publish";
import { assessRisk } from "./llm-pipeline";
import { resolveEffectiveSensitivity, resolvePublishMode } from "./calculator";
import { refreshQueueMessage } from "./queue";
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
  // Read-only interactions — no queue refresh needed.
  if (interaction.isButton() && interaction.customId.startsWith("authpost_info_")) {
    return handleAuthPostInfo(interaction, client);
  }
  if (interaction.isButton() && interaction.customId.startsWith("authpost_edit_open_")) {
    return handleAuthPostEditOpen(interaction, client);
  }

  // State-changing interactions — refresh the standing queue message afterwards.
  let handled = false;

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("authpost_submit_")) {
      await handleAuthPostModalSubmit(interaction, client);
      handled = true;
    } else if (interaction.customId.startsWith("authpost_edit_")) {
      await handleAuthPostEditSubmit(interaction, client);
      handled = true;
    }
  }

  if (!handled && interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith("authpost_approve_")) {
      await handleAuthPostApprove(interaction, client);
    } else if (customId.startsWith("authpost_object_")) {
      await handleAuthPostObject(interaction, client);
    } else if (customId.startsWith("authpost_publish_")) {
      await handleAuthPostManualPublish(interaction, client);
    } else if (customId.startsWith("authpost_withdraw_")) {
      await handleAuthPostWithdraw(interaction, client);
    } else if (customId.startsWith("authpost_request_edit_")) {
      await handleAuthPostRequestEdit(interaction, client);
    } else if (customId.startsWith("authpost_cancel_hold_")) {
      await handleAuthPostCancelHold(interaction, client);
    } else {
      return;
    }
  }

  // Fire-and-forget — queue refresh must not block or throw to the caller.
  void refreshQueueMessage(client).catch(err =>
    console.error('[Queue] Post-interaction refresh failed:', err)
  );
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
    const notesRaw = interaction.fields.getTextInputValue("notes") || undefined;

    // Parse "schedule: YYYY-MM-DDTHH:MM" from notes (treated as AEST).
    // Defaults to next weekday 9am AEST at publish time if not specified.
    const scheduledAt = notesRaw ? parseScheduleFromText(notesRaw) ?? undefined : undefined;

    const content: PostContent = { commentary, articleLink, policyLinks, hashtags };

    // Validate before creating anything in the DB.
    const validationErrors = validatePostForDestinations(content, destinations);
    const hardErrors = validationErrors.filter(e => e.includes('limit'));
    if (hardErrors.length > 0) {
      return interaction.editReply({
        embeds: [errorEmbed('Validation Error', hardErrors.join('\n'))],
      });
    }

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
        notes: notesRaw,
        selfApprove,
        scheduledAt,
        approverPool: { name: "authnational", memberIds: approverPoolMemberIds },
        channelId: interaction.channelId ?? interaction.guildId ?? "unknown",
      },
      config.requiredApprovals,
      config.initialTimerMinutes
    );

    // Run AI risk assessment — advisory, non-blocking. Failure is silently swallowed.
    let riskAnnotation: Awaited<ReturnType<typeof assessRisk>> | null = null;
    try {
      riskAnnotation = await assessRisk({ content, destinations, submitterSensitivity: sensitivity });
    } catch { /* LLM unavailable — proceed without annotation */ }

    // If AI escalates, use the higher sensitivity for requiredApprovals and publish mode.
    const effectiveSensitivity = riskAnnotation
      ? resolveEffectiveSensitivity(sensitivity, riskAnnotation.suggestedSensitivity, riskAnnotation.verdict)
      : sensitivity;
    const effectiveConfig = SENSITIVITY_CONFIG[effectiveSensitivity];

    // Persist AI assessment fields onto the submission.
    const submissionWithRisk = {
      ...submission,
      ...(riskAnnotation ? {
        aiRiskVerdict: riskAnnotation.verdict,
        aiSuggestedSensitivity: riskAnnotation.suggestedSensitivity,
        aiRiskSummary: riskAnnotation.summary,
        aiRiskFlags: riskAnnotation.flags,
        requiredApprovals: effectiveConfig.requiredApprovals,
      } : {}),
    };
    db.updateSubmission(submissionWithRisk);

    const embed = createAuthPostEmbed(submissionWithRisk, submissionWithRisk.timerCalculation, riskAnnotation);
    const components = createAuthPostButtons(submissionWithRisk.id);

    const channel = interaction.guild?.channels.cache.find(c => c.name === "auth-socmed");
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      return interaction.editReply({
        embeds: [errorEmbed("Channel Not Found", "Could not find #auth-socmed channel")],
      });
    }

    const message = await channel.send({ embeds: [embed], components });
    db.updateSubmission({ ...submissionWithRisk, messageId: message.id, channelId: channel.id });

    const escalationNote = riskAnnotation?.verdict === 'escalate'
      ? `\n⚠️ AI escalated sensitivity to **${effectiveSensitivity}** — required approvals: ${effectiveConfig.requiredApprovals}`
      : '';

    // Image warnings are advisory (not hard errors) — surface them in the confirmation.
    const imageWarnings = validationErrors.filter(e => !e.includes('limit'));
    const imageNote = imageWarnings.length > 0
      ? `\n\n⚠️ **Image required:** ${imageWarnings.join(' ')}`
      : '';

    return interaction.editReply({
      embeds: [{
        title: "✅ Auth Post Submitted",
        description: `Your request **${submissionWithRisk.id}** has been posted to <#${channel.id}> for approval.\n\nRequired approvals: ${effectiveConfig.requiredApprovals}${selfApprove ? " (self-approved, 1 more needed)" : ""}${escalationNote}${imageNote}`,
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

    // Persist vote + submission update + audit log atomically to prevent partial writes.
    db.atomicVoteAndUpdate(latestVote, updatedSubmission, {
      postId,
      eventType: "vote",
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      timestamp: new Date(),
      details: { voteType },
    });

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
 * Approval threshold met - mark approved, post the publish-pending state, and schedule on Fedica.
 * Uses atomicResolve to guard against two concurrent approvals both triggering the Fedica call.
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

  // Only proceed if the submission is still PENDING in the DB (concurrent-safe).
  const claimed = db.atomicResolve(approved, {
    postId: approved.id,
    eventType: "publish_attempt",
    timestamp: new Date(),
    details: { reason },
  });

  if (!claimed) {
    // Another interaction already resolved this submission.
    return interaction.editReply({
      embeds: [errorEmbed("Already Resolved", `${submission.id} was already resolved by a concurrent interaction.`)],
    });
  }

  const hadObjections = submission.objectVotes.length > 0;
  const wasSupermajority = reason.includes('Supermajority');
  const publishMode = resolvePublishMode(approved.sensitivity, hadObjections, wasSupermajority);

  const message = await getInteractionMessage(interaction, submission.messageId);

  if (publishMode === 'manual') {
    // Human must click "Publish" — update embed with a manual-publish button
    const holdEmbed = new EmbedBuilder()
      .setTitle(`✅ ${approved.id} Approved — Awaiting Manual Publish`)
      .setDescription(
        `Approved (${reason}).\nSensitivity **${approved.sensitivity}** requires manual publish.\n` +
        `Destinations: ${approved.destinations.join(', ')}`
      )
      .setColor(0x5c9de0);
    const publishButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_publish_${approved.id}`).setLabel('📤 Publish to Fedica').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`authpost_withdraw_${approved.id}`).setLabel('🚫 Withdraw').setStyle(ButtonStyle.Danger),
    );
    if (message) await message.edit({ embeds: [holdEmbed], components: [publishButton] });
    return interaction.editReply({
      embeds: [{ title: '✅ Approved', description: `**${approved.id}** approved. Manual publish required — click "Publish to Fedica" on the post.`, color: 0x5c9de0 }],
    });
  }

  if (publishMode === 'hold') {
    // 15-minute hold window — auto-publishes via timer service unless withdrawn
    const holdMinutes = 15;
    const autoPublishAt = new Date(Date.now() + holdMinutes * 60000);
    const holdEmbed = new EmbedBuilder()
      .setTitle(`✅ ${approved.id} Approved — Publishing in ${holdMinutes}m`)
      .setDescription(
        `Approved (${reason}). Auto-publishes <t:${Math.floor(autoPublishAt.getTime() / 1000)}:R>.\n` +
        `Destinations: ${approved.destinations.join(', ')}`
      )
      .setColor(0xffa500);
    const cancelButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_cancel_hold_${approved.id}`).setLabel('🚫 Cancel Hold').setStyle(ButtonStyle.Danger),
    );
    if (message) await message.edit({ embeds: [holdEmbed], components: [cancelButton] });
    db.updateSubmission({ ...approved, scheduledAt: autoPublishAt });
    return interaction.editReply({
      embeds: [{ title: '✅ Approved', description: `**${approved.id}** approved. Auto-publishes in ${holdMinutes} minutes unless cancelled.`, color: 0xffa500 }],
    });
  }

  // auto — publish immediately
  const pendingEmbed = new EmbedBuilder()
    .setTitle(`✅ ${approved.id} Approved — Scheduling on Fedica`)
    .setDescription(`Approved (${reason}). Destinations: ${approved.destinations.join(", ")}`)
    .setColor(0x00aa00);
  if (message) await message.edit({ embeds: [pendingEmbed], components: [] });

  const result = await publishToFedica(approved);

  const finalSubmission: SocialAuthSubmission = result.success
    ? {
        ...approved,
        status: AuthPostStatus.PUBLISHED,
        publishedAt: new Date(),
        fedicaPostId: result.fedicaPostId,
        fedicaScheduledAt: result.fedicaScheduledAt,
      }
    : { ...approved, status: AuthPostStatus.PUBLISH_FAILED, fedicaError: result.error };

  db.atomicResolve(finalSubmission, {
    postId: approved.id,
    eventType: result.success ? "publish_success" : "publish_failure",
    timestamp: new Date(),
    details: result,
  }, AuthPostStatus.APPROVED);

  const schedStr = result.fedicaScheduledAt
    ? `\nScheduled for: **${result.fedicaScheduledAt.toISOString()}**`
    : '';

  const finalEmbed = new EmbedBuilder()
    .setTitle(result.success ? `📅 ${approved.id} Scheduled on Fedica` : `❌ ${approved.id} Fedica Schedule Failed`)
    .setDescription(
      result.success
        ? `Destinations: ${approved.destinations.join(", ")}${schedStr}\nFedica ID: ${result.fedicaPostId}`
        : `Destinations: ${approved.destinations.join(", ")}\nError: ${result.error}`
    )
    .setColor(result.success ? 0x00aa00 : 0xff4444);
  const finalComponents = result.success ? [] : [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_publish_${approved.id}`).setLabel('🔄 Retry Publish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`authpost_withdraw_${approved.id}`).setLabel('🚫 Withdraw').setStyle(ButtonStyle.Danger),
    ),
  ];
  if (message) await message.edit({ embeds: [finalEmbed], components: finalComponents });

  return interaction.editReply({
    embeds: [{
      title: result.success ? "✅ Approved & Scheduled" : "⚠️ Approved, Schedule Failed",
      description: result.success
        ? `**${approved.id}** was approved and scheduled on Fedica.${schedStr}`
        : `**${approved.id}** was approved but the Fedica schedule failed: ${result.error}`,
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

function createAuthPostEmbed(
  submission: SocialAuthSubmission,
  timerCalc: TimerCalculation,
  riskAnnotation?: Awaited<ReturnType<typeof assessRisk>> | null
): EmbedBuilder {
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

  // AI risk annotation — shown when assessment is available
  const risk = riskAnnotation ?? (submission.aiRiskSummary ? {
    verdict: submission.aiRiskVerdict,
    suggestedSensitivity: submission.aiSuggestedSensitivity,
    summary: submission.aiRiskSummary,
    flags: submission.aiRiskFlags ?? [],
  } : null);

  if (risk?.summary) {
    const verdictEmoji = risk.verdict === 'escalate' ? '⚠️' : risk.verdict === 'downgrade' ? '🔽' : '✅';
    const sensitivityNote = risk.suggestedSensitivity && risk.suggestedSensitivity !== submission.sensitivity
      ? ` (suggests **${risk.suggestedSensitivity}**)`
      : '';
    embed.addFields({
      name: `${verdictEmoji} AI Risk Assessment${sensitivityNote}`,
      value: risk.summary.substring(0, 500),
      inline: false,
    });
    const criticalFlags = (risk.flags ?? []).filter((f: { severity: string }) => f.severity === 'critical');
    if (criticalFlags.length) {
      embed.addFields({
        name: '🚨 Critical Flags',
        value: criticalFlags.map((f: { reason: string; policyReference?: string }) =>
          `• ${f.reason}${f.policyReference ? ` *(${f.policyReference})*` : ''}`
        ).join('\n').substring(0, 500),
        inline: false,
      });
    }
  }

  return embed;
}

function createAuthPostButtons(postId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_approve_${postId}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`authpost_object_${postId}`).setLabel("❌ Object").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`authpost_edit_open_${postId}`).setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`authpost_request_edit_${postId}`).setLabel("↩️ Send Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`authpost_info_${postId}`).setLabel("📋 Details").setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function handleAuthPostManualPublish(interaction: ButtonInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[2];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });
    if (submission.status !== AuthPostStatus.APPROVED && submission.status !== AuthPostStatus.PUBLISH_FAILED) {
      return interaction.editReply({ embeds: [errorEmbed("Invalid State", `Post is ${submission.status}, not approved`)] });
    }

    const message = await getInteractionMessage(interaction, submission.messageId);
    const pendingEmbed = new EmbedBuilder()
      .setTitle(`📤 ${submission.id} — Publishing to Fedica`)
      .setDescription(`Manual publish triggered by <@${interaction.user.id}>`)
      .setColor(0x00aa00);
    if (message) await message.edit({ embeds: [pendingEmbed], components: [] });

    const result = await publishToFedica(submission);
    const finalSubmission: SocialAuthSubmission = result.success
      ? { ...submission, status: AuthPostStatus.PUBLISHED, publishedAt: new Date(), fedicaPostId: result.fedicaPostId, fedicaScheduledAt: result.fedicaScheduledAt }
      : { ...submission, status: AuthPostStatus.PUBLISH_FAILED, fedicaError: result.error };
    db.updateSubmission(finalSubmission);

    const schedStr = result.fedicaScheduledAt ? `\nScheduled: **${result.fedicaScheduledAt.toISOString()}**` : '';
    const finalEmbed = new EmbedBuilder()
      .setTitle(result.success ? `📅 ${submission.id} Scheduled` : `❌ ${submission.id} Publish Failed`)
      .setDescription(result.success ? `Destinations: ${submission.destinations.join(', ')}${schedStr}\nFedica ID: ${result.fedicaPostId}` : `Error: ${result.error}`)
      .setColor(result.success ? 0x00aa00 : 0xff4444);
    const retryComponents = result.success ? [] : [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`authpost_publish_${submission.id}`).setLabel('🔄 Retry Publish').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`authpost_withdraw_${submission.id}`).setLabel('🚫 Withdraw').setStyle(ButtonStyle.Danger),
      ),
    ];
    if (message) await message.edit({ embeds: [finalEmbed], components: retryComponents });

    return interaction.editReply({
      embeds: [{ title: result.success ? '✅ Published' : '⚠️ Publish Failed', description: result.success ? `**${submission.id}** scheduled on Fedica.${schedStr}` : result.error, color: result.success ? 0x00aa00 : 0xff4444 }],
    });
  } catch (error) {
    return interaction.editReply({ embeds: [errorEmbed("Publish Error", String(error))] });
  }
}

async function handleAuthPostWithdraw(interaction: ButtonInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[2];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });

    const canWithdraw = interaction.user.id === submission.submitterId ||
      interaction.memberPermissions?.has('ManageMessages');
    if (!canWithdraw) {
      return interaction.editReply({ embeds: [errorEmbed("Unauthorized", "Only the submitter or a moderator can withdraw this post")] });
    }

    db.updateSubmission({ ...submission, status: AuthPostStatus.WITHDRAWN, resolvedAt: new Date(), outcome: 'withdrawn', outcomeReason: `Withdrawn by ${interaction.user.username}` });

    const message = await getInteractionMessage(interaction, submission.messageId);
    const withdrawnEmbed = new EmbedBuilder()
      .setTitle(`🚫 ${submission.id} Withdrawn`)
      .setDescription(`Withdrawn by <@${interaction.user.id}>`)
      .setColor(0x888888);
    if (message) await message.edit({ embeds: [withdrawnEmbed], components: [] });

    return interaction.editReply({ embeds: [{ title: '🚫 Withdrawn', description: `**${submission.id}** has been withdrawn.`, color: 0x888888 }] });
  } catch (error) {
    return interaction.editReply({ embeds: [errorEmbed("Withdraw Error", String(error))] });
  }
}

/**
 * Approver sends the post back to the submitter for revisions.
 * Sets status to IN_EDIT, pausing the timer and showing a Resubmit button.
 */
async function handleAuthPostRequestEdit(interaction: ButtonInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[3];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });
    if (submission.status !== AuthPostStatus.PENDING) {
      return interaction.editReply({ embeds: [errorEmbed("Invalid State", `Post is ${submission.status}, not pending`)] });
    }

    db.updateSubmission({ ...submission, status: AuthPostStatus.IN_EDIT });
    db.addAuditLog({
      postId,
      eventType: 'edit',
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      timestamp: new Date(),
      details: { action: 'sent_for_edits' },
    });

    const needsEditsEmbed = new EmbedBuilder()
      .setTitle(`✏️ ${postId} — Needs Edits`)
      .setDescription(
        `Sent back for edits by <@${interaction.user.id}>.\n` +
        `<@${submission.submitterId}> please revise and click **Resubmit**.`
      )
      .setColor(0x5c9de0);
    const resubmitButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_edit_open_${postId}`).setLabel('✏️ Resubmit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`authpost_withdraw_${postId}`).setLabel('🚫 Withdraw').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`authpost_info_${postId}`).setLabel('📋 Details').setStyle(ButtonStyle.Secondary),
    );

    const message = await getInteractionMessage(interaction, submission.messageId);
    if (message) await message.edit({ embeds: [needsEditsEmbed], components: [resubmitButtons] });

    return interaction.editReply({
      embeds: [{
        title: '↩️ Sent for Edits',
        description: `**${postId}** sent back to <@${submission.submitterId}> for revisions.`,
        color: 0x5c9de0,
      }],
    });
  } catch (error) {
    return interaction.editReply({ embeds: [errorEmbed("Error", String(error))] });
  }
}

/**
 * Cancel the 15-minute hold window and revert to manual-publish mode.
 * Keeps the APPROVED status but clears scheduledAt so the timer service won't auto-fire.
 */
async function handleAuthPostCancelHold(interaction: ButtonInteraction, _client: BotClient) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const db = new SocialAuthDatabaseManager();
    const postId = interaction.customId.split("_")[3];
    const submission = db.getSubmission(postId);
    if (!submission) return interaction.editReply({ embeds: [errorEmbed("Not Found", "Auth post not found")] });
    if (submission.status !== AuthPostStatus.APPROVED) {
      return interaction.editReply({ embeds: [errorEmbed("Invalid State", `Post is ${submission.status}, not approved`)] });
    }

    const canCancel = interaction.user.id === submission.submitterId ||
      interaction.memberPermissions?.has('ManageMessages');
    if (!canCancel) {
      return interaction.editReply({ embeds: [errorEmbed("Unauthorized", "Only the submitter or a moderator can cancel the hold")] });
    }

    // Clear scheduledAt so the timer service won't auto-publish
    db.updateSubmission({ ...submission, scheduledAt: undefined });
    db.addAuditLog({
      postId,
      eventType: 'timer_update',
      actorId: interaction.user.id,
      actorName: interaction.user.username,
      timestamp: new Date(),
      details: { action: 'hold_cancelled' },
    });

    const manualEmbed = new EmbedBuilder()
      .setTitle(`✅ ${postId} Approved — Awaiting Manual Publish`)
      .setDescription(
        `Hold cancelled by <@${interaction.user.id}>. Use the Publish button when ready.\n` +
        `Destinations: ${submission.destinations.join(', ')}`
      )
      .setColor(0x5c9de0);
    const publishButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`authpost_publish_${postId}`).setLabel('📤 Publish to Fedica').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`authpost_withdraw_${postId}`).setLabel('🚫 Withdraw').setStyle(ButtonStyle.Danger),
    );

    const message = await getInteractionMessage(interaction, submission.messageId);
    if (message) await message.edit({ embeds: [manualEmbed], components: [publishButtons] });

    return interaction.editReply({
      embeds: [{
        title: '✅ Hold Cancelled',
        description: `**${postId}** auto-publish cancelled. Use the Publish button when ready.`,
        color: 0x5c9de0,
      }],
    });
  } catch (error) {
    return interaction.editReply({ embeds: [errorEmbed("Error", String(error))] });
  }
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
  handleAuthPostManualPublish,
  handleAuthPostWithdraw,
  handleAuthPostRequestEdit,
  handleAuthPostCancelHold,
};
