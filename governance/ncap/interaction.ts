/**
 * NCAP Interaction Handlers
 * Handles vote submissions, gantry transitions, and dynamic timer recalculation
 * Handles vote submissions, gantry transitions, and dynamic timer recalculation
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
} from "discord.js";
import { BotClient } from "@/types/discord";
import { NcapDatabaseManager } from "./database";
import {
  GantryState,
  NcapSubmission,
  TimerCalculation,
  VoteType,
  NcapStatus,
} from "./types";
import {
  addVote as applyVote,
  calculateDynamicTimer,
  checkSupermajorityBypass,
} from "./calculator";
import { errorEmbed } from "@/utils/responses";

// Category to approver pool and timer defaults mapping
const CATEGORY_CONFIG: Record<
  string,
  { approverPool: string; defaultHours: number; urgency: "urgent" | "standard" | "significant" | "major" }
> = {
  comm_urgent: { approverPool: "wg_comms", defaultHours: 4, urgency: "urgent" },
  comm_routine: { approverPool: "wg_comms", defaultHours: 12, urgency: "standard" },
  ops_routine: { approverPool: "committee", defaultHours: 24, urgency: "standard" },
  policy_sig: { approverPool: "wg_policy", defaultHours: 48, urgency: "significant" },
  fin_routine: { approverPool: "committee", defaultHours: 24, urgency: "standard" },
  fin_sig: { approverPool: "committee", defaultHours: 48, urgency: "significant" },
  gov_major: { approverPool: "committee", defaultHours: 72, urgency: "major" },
};

const GANTRY_COLORS: Record<GantryState, number> = {
  [GantryState.NONE]: 0xffa500,
  [GantryState.NATURAL_APPROVAL]: 0x90ee90,
  [GantryState.VOTED_APPROVAL]: 0xffa500,
  [GantryState.OBJECTION]: 0xff4444,
};

/**
 * Main interaction router for NCAP
 */
export default async function handleNcapInteraction(
  interaction: Interaction,
  client: BotClient
) {
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("ncap_submit_")) {
      return handleNcapModalSubmit(interaction, client);
    }
  }

  // Handle button interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("ncap_approve_")) {
      return handleNcapApprove(interaction, client);
    } else if (customId.startsWith("ncap_object_")) {
      return handleNcapObject(interaction, client);
    } else if (customId.startsWith("ncap_info_")) {
      return handleNcapInfo(interaction, client);
    }
  }
}

/**
 * Handle NCAP submission from modal
 */
async function handleNcapModalSubmit(
  interaction: ModalSubmitInteraction,
  client: BotClient
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new NcapDatabaseManager();
    // Parse custom ID for category
    const customIdParts = interaction.customId.split("_");
    const categoryMatch = customIdParts[2];
    const category = categoryMatch || "ops_routine";

    // Get form data
    const title = interaction.fields.getTextInputValue("title");
    const description = interaction.fields.getTextInputValue("description");
    const rationale = interaction.fields.getTextInputValue("rationale") || "";
    const budgetCategory =
      interaction.fields.getTextInputValue("budget_category") || "";
    const linksText = interaction.fields.getTextInputValue("links") || "";
    const links = linksText
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 5); // Max 5 links

    // Get options from category config
    const categoryConfig = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.ops_routine;
    const timerHours = categoryConfig.defaultHours;
    const spendingAmount = 0; // Would come from slash command option

    const approverPoolMemberIds = interaction.guild
      ? interaction.guild.members.cache
          .filter((member) => !member.user.bot)
          .map((member) => member.id)
      : [];

    const submission = db.createSubmission({
      proposerId: interaction.user.id,
      proposerName: interaction.user.username,
      approverPool: {
        type: "custom",
        name: categoryConfig.approverPool,
        memberIds: approverPoolMemberIds,
      },
      title,
      description,
      rationale,
      links,
      category,
      budgetCategory,
      spendingAmount,
      initialTimerMinutes: timerHours * 60,
      urgency: categoryConfig.urgency,
      channelId: interaction.channelId ?? interaction.guildId ?? "unknown",
    });

    const timerCalc = submission.timerCalculation;

    // Create Discord embed showing submission
    const embed = createNcapEmbed(submission, timerCalc);

    // Create interaction buttons
    const components = createNcapButtons(submission.id);

    // Send to NCAP voting channel
    const channel = interaction.guild?.channels.cache.find(
      (c) => c.name === "ncap-votes"
    );

    if (!channel || !channel.isTextBased()) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            "NCAP Channel Not Found",
            "Could not find #ncap-votes channel"
          ),
        ],
      });
    }

    // Post the NCAP submission
    if (!("send" in channel)) {
      return interaction.editReply({
        embeds: [errorEmbed("NCAP Channel Error", "Configured channel cannot receive messages.")],
      });
    }
    const message = await channel.send({ embeds: [embed], components });
    db.updateSubmission({ ...submission, messageId: message.id, channelId: channel.id });

    return interaction.editReply({
      embeds: [
        {
          title: "✅ NCAP Submission Created",
          description: `Your NCAP submission **${submission.id}** has been posted for voting.\n\nTimer: ${timerHours} hours\nApprover Pool: ${categoryConfig.approverPool}`,
          color: 0x00aa00,
        },
      ],
    });
  } catch (error) {
    console.error("NCAP Modal Submit Error:", error);
    return interaction.editReply({
      embeds: [errorEmbed("Submission Error", String(error))],
    });
  }
}

/**
 * Handle approve button click
 */
async function handleNcapApprove(
  interaction: ButtonInteraction,
  _client: BotClient
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new NcapDatabaseManager();
    // Extract NCAP ID from custom ID (ncap_approve_NCAPID)
    const ncapId = interaction.customId.split("_")[2];
    if (!ncapId) {
      return interaction.editReply({
        embeds: [errorEmbed("Error", "Invalid NCAP ID")],
      });
    }

    // Get submission
    const submission = db.getSubmission(ncapId);
    if (!submission) {
      return interaction.editReply({
        embeds: [errorEmbed("Not Found", "NCAP submission not found")],
      });
    }

    // Get vote counts
    const voters = db.getVoters(ncapId);

    // Check if already voted
    if (voters.includes(interaction.user.id)) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            "Already Voted",
            "You have already cast your vote on this NCAP. Votes cannot be changed."
          ),
        ],
      });
    }

    // Check if proposer
    if (interaction.user.id === submission.proposerId) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            "Cannot Vote",
            "Proposers cannot vote on their own NCAP submissions."
          ),
        ],
      });
    }

    const voteResult = applyVote(
      submission,
      interaction.user.id,
      interaction.user.username,
      VoteType.APPROVE
    );
    if (voteResult.error) {
      return interaction.editReply({ embeds: [errorEmbed("Vote Error", voteResult.error)] });
    }

    const updatedSubmission = voteResult.submission;
    const latestVote = updatedSubmission.approveVotes[updatedSubmission.approveVotes.length - 1];
    db.addVote(latestVote);
    db.updateSubmission(updatedSubmission);

    const supermajority = checkSupermajorityBypass(
      updatedSubmission.approveVotes,
      updatedSubmission.approverPool.memberIds.length
    );
    if (supermajority) {
      const resolvedSubmission: NcapSubmission = {
        ...updatedSubmission,
        status: NcapStatus.APPROVED,
        resolvedAt: new Date(),
        outcome: "approved",
        outcomeReason: "Supermajority bypass reached",
      };
      db.updateSubmission(resolvedSubmission);

      const resolved = new EmbedBuilder()
        .setTitle("⚡ NCAP Instantly Approved")
        .setDescription(
          `**${ncapId}** has reached supermajority approval (≥75%) and is instantly approved.`
        )
        .addFields({
          name: "Final Vote",
          value: `${resolvedSubmission.approveVotes.length} Approvals / ${resolvedSubmission.objectVotes.length} Objections`,
        })
        .setColor(0x00aa00);

      const message = await getInteractionMessage(interaction, submission.messageId);
      if (message) {
        await message.edit({ embeds: [resolved], components: [] });
      }

      return interaction.editReply({
        embeds: [
          {
            title: "✅ Vote Recorded",
            description: `Your approval vote has been recorded. This NCAP has been **instantly approved** due to supermajority (≥75%).`,
            color: 0x00aa00,
          },
        ],
      });
    }

    // Update the main NCAP message with new calculations
    const timerCalc = calculateDynamicTimer(
      updatedSubmission.initialTimerMinutes,
      updatedSubmission.approveVotes,
      updatedSubmission.objectVotes,
      updatedSubmission.approverPool.memberIds.length
    );
    const updatedEmbed = createNcapEmbed(updatedSubmission, timerCalc);
    const updatedComponents = createNcapButtons(ncapId);

    const message = await getInteractionMessage(interaction, submission.messageId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed], components: updatedComponents });
    }

    return interaction.editReply({
      embeds: [
        {
          title: "✅ Vote Recorded",
          description: `Your approval vote has been recorded. Timer and calculations updated.`,
          color: 0x00aa00,
        },
      ],
    });
  } catch (error) {
    console.error("NCAP Approve Error:", error);
    return interaction.editReply({
      embeds: [errorEmbed("Vote Error", String(error))],
    });
  }
}

/**
 * Handle object button click
 */
async function handleNcapObject(
  interaction: ButtonInteraction,
  _client: BotClient
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new NcapDatabaseManager();
    // Extract NCAP ID
    const ncapId = interaction.customId.split("_")[2];
    if (!ncapId) {
      return interaction.editReply({
        embeds: [errorEmbed("Error", "Invalid NCAP ID")],
      });
    }

    // Get submission
    const submission = db.getSubmission(ncapId);
    if (!submission) {
      return interaction.editReply({
        embeds: [errorEmbed("Not Found", "NCAP submission not found")],
      });
    }

    // Get vote counts
    const voters = db.getVoters(ncapId);

    // Check if already voted
    if (voters.includes(interaction.user.id)) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            "Already Voted",
            "You have already cast your vote on this NCAP. Votes cannot be changed."
          ),
        ],
      });
    }

    // Check if proposer
    if (interaction.user.id === submission.proposerId) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            "Cannot Vote",
            "Proposers cannot vote on their own NCAP submissions."
          ),
        ],
      });
    }

    const voteResult = applyVote(
      submission,
      interaction.user.id,
      interaction.user.username,
      VoteType.OBJECT
    );
    if (voteResult.error) {
      return interaction.editReply({ embeds: [errorEmbed("Vote Error", voteResult.error)] });
    }

    const updatedSubmission = voteResult.submission;
    const latestVote = updatedSubmission.objectVotes[updatedSubmission.objectVotes.length - 1];
    db.addVote(latestVote);
    db.updateSubmission(updatedSubmission);

    // Check if objection pool fills (reaches 20% - can be vetoed)
    const totalVotes = updatedSubmission.approveVotes.length + updatedSubmission.objectVotes.length;
    const objectionRate = totalVotes > 0 ? updatedSubmission.objectVotes.length / totalVotes : 0;
    const canBeVetoed = objectionRate >= 0.2;

    // Update the main NCAP message with new calculations
    const timerCalc = calculateDynamicTimer(
      updatedSubmission.initialTimerMinutes,
      updatedSubmission.approveVotes,
      updatedSubmission.objectVotes,
      updatedSubmission.approverPool.memberIds.length
    );
    const updatedEmbed = createNcapEmbed(updatedSubmission, timerCalc);
    const updatedComponents = createNcapButtons(ncapId);

    const message = await getInteractionMessage(interaction, submission.messageId);
    if (message) {
      await message.edit({ embeds: [updatedEmbed], components: updatedComponents });
    }

    return interaction.editReply({
      embeds: [
        {
          title: "⚠️ Objection Recorded",
          description: `Your objection vote has been recorded. Timer and calculations updated.${
            canBeVetoed
              ? "\n\n⚡ **Veto Pool Activated** - 20% of votes are objections. This NCAP can now be vetoed."
              : ""
          }`,
          color: 0xff9900,
        },
      ],
    });
  } catch (error) {
    console.error("NCAP Object Error:", error);
    return interaction.editReply({
      embeds: [errorEmbed("Vote Error", String(error))],
    });
  }
}

/**
 * Handle info button click - show detailed submission info
 */
async function handleNcapInfo(
  interaction: ButtonInteraction,
  _client: BotClient
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const db = new NcapDatabaseManager();
    const ncapId = interaction.customId.split("_")[2];

    const submission = db.getSubmission(ncapId);
    if (!submission) {
      return interaction.editReply({
        embeds: [errorEmbed("Not Found", "NCAP submission not found")],
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Full Details: ${submission.id}`)
      .addFields(
        { name: "Title", value: submission.title, inline: false },
        { name: "Description", value: submission.description, inline: false },
        { name: "Proposer", value: `<@${submission.proposerId}>`, inline: true },
        { name: "Category", value: submission.category, inline: true },
        { name: "Approver Pool", value: submission.approverPool.name, inline: true }
      )
      .setColor(0x0099ff);

    if (submission.rationale) {
      embed.addFields({
        name: "Rationale",
        value: submission.rationale,
        inline: false,
      });
    }

    if ((submission.spendingAmount ?? 0) > 0) {
      embed.addFields({
        name: "Spending Authorization",
        value: `$${(submission.spendingAmount ?? 0).toFixed(2)} AUD`,
        inline: true,
      });
    }

    if (submission.links && submission.links.length > 0) {
      embed.addFields({
        name: "References",
        value: submission.links.map((l) => `[Link](${l})`).join("\n"),
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("NCAP Info Error:", error);
    return interaction.editReply({
      embeds: [errorEmbed("Error", String(error))],
    });
  }
}

/**
 * Create NCAP voting embed with timer calculations
 */
function createNcapEmbed(
  submission: NcapSubmission,
  timerCalc: TimerCalculation
): EmbedBuilder {
  const db = new NcapDatabaseManager();
  const approveCount = db.getApprovalCount(submission.id);
  const objectCount = db.getObjectionCount(submission.id);
  const totalVotes = approveCount + objectCount;

  const approvalRate =
    totalVotes > 0 ? ((approveCount / totalVotes) * 100).toFixed(1) : "0.0";
  const objectionRate =
    totalVotes > 0 ? ((objectCount / totalVotes) * 100).toFixed(1) : "0.0";

  const timeRemaining = Math.ceil(
    ((submission.expiresAt?.getTime() ?? Date.now()) - Date.now()) / (1000 * 60)
  );
  const gantryColor =
    GANTRY_COLORS[timerCalc.gantryState] || GANTRY_COLORS[GantryState.VOTED_APPROVAL];

  let gantryStatus = "🟠 Voted Approval";
  if (timerCalc.gantryState === GantryState.NATURAL_APPROVAL) {
    gantryStatus = "🟢 Natural Approval";
  } else if (timerCalc.gantryState === GantryState.OBJECTION) {
    gantryStatus = "🔴 Objection Gantry";
  }

  const embed = new EmbedBuilder()
    .setTitle(`NCAP: ${submission.title}`)
    .setDescription(submission.description)
    .setColor(gantryColor)
    .addFields(
      {
        name: "NCAP ID",
        value: submission.id,
        inline: true,
      },
      {
        name: "Status",
        value: gantryStatus,
        inline: true,
      },
      {
        name: "Time Remaining",
        value: `${timeRemaining} minutes`,
        inline: true,
      },
      {
        name: "Votes",
        value: `✅ ${approveCount} (${approvalRate}%) | ❌ ${objectCount} (${objectionRate}%)`,
        inline: false,
      },
      {
        name: "Timer Calculation",
        value: `Base: ${timerCalc.initialTimerMinutes}m → Modified: ${Math.round(timerCalc.currentTimerMinutes)}m\nMultiplier: ${timerCalc.timerModifier.toFixed(2)}x`,
        inline: false,
      },
      {
        name: "Submission Info",
        value: `Approver Pool: ${submission.approverPool.name}\nCategory: ${submission.category}`,
        inline: false,
      }
    );

  if (submission.rationale) {
    embed.addFields({
      name: "Rationale",
      value: submission.rationale.substring(0, 500),
      inline: false,
    });
  }

  if ((submission.spendingAmount ?? 0) > 0) {
    embed.addFields({
      name: "Spending Authorization",
      value: `$${(submission.spendingAmount ?? 0).toFixed(2)} AUD`,
      inline: true,
    });
  }

  return embed;
}

/**
 * Create voting buttons for NCAP
 */
function createNcapButtons(ncapId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ncap_approve_${ncapId}`)
        .setLabel("✅ Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ncap_object_${ncapId}`)
        .setLabel("❌ Object")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ncap_info_${ncapId}`)
        .setLabel("📋 Details")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function getInteractionMessage(interaction: ButtonInteraction, messageId: string) {
  if (!messageId || !interaction.channel || !("messages" in interaction.channel)) {
    return null;
  }
  try {
    return await interaction.channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

export {
  handleNcapModalSubmit,
  handleNcapApprove,
  handleNcapObject,
  handleNcapInfo,
};
