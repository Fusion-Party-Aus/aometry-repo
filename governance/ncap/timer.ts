/**
 * NCAP Timer Service
 * Background timer task that updates submission timers, detects gantry transitions,
 * and triggers notifications per Constitutional Rules 49, 50, 51, 76
 */

import { BotClient } from "@/types/discord";
import { EmbedBuilder, Message } from "discord.js";
import { NcapDatabaseManager } from "./database";
import { calculateDynamicTimer } from "./calculator";
import { GantryState, NcapStatus, NcapSubmission, TIMER_CONSTANTS } from "./types";

// Configuration
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute (60 seconds)
const NOTIFICATION_THRESHOLD_MINUTES = 60; // Notify 1 hour before expiration
const BUSINESS_HOURS_START = 9; // 9 AM AEST
const BUSINESS_HOURS_END = 21; // 9 PM AEST

/**
 * Start the background timer service for NCAP submissions
 */
export function startNcapTimerService(client: BotClient) {
  console.log("[NCAP Timer Service] Started background timer service");

  // Run immediately then set interval
  void safeCheck(client);
  setInterval(() => {
    void safeCheck(client);
  }, CHECK_INTERVAL_MS);
}

/**
 * Safe wrapper for timer check
 */
async function safeCheck(client: BotClient) {
  try {
    await checkTimers(client);
  } catch (error) {
    console.error("[NCAP Timer Service] Fatal Error:", error);
  }
}

/**
 * Check if current time is within business hours
 * Business hours: 9 AM - 9 PM AEST (UTC+10)
 */
function isBusinessHours(): boolean {
  const now = new Date();
  const aestTime = new Date(now.toLocaleString("en-AU", { timeZone: "Australia/Sydney" }));
  const hour = aestTime.getHours();

  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

/**
 * Main timer check function
 * Processes all active NCAP submissions, updates timers, detects gantry transitions
 */
async function checkTimers(client: BotClient) {
  const db = new NcapDatabaseManager();
  try {
    const submissions = db.getActiveSubmissions();

    for (const submission of submissions) {
      const minutesRemaining = getMinutesRemaining(submission);

      if (isBusinessHours()) {
        if (minutesRemaining <= 0) {
          // Timer expired
          await processExpiration(client, db, submission);
          continue;
        }

        // Check for notification threshold
        if (minutesRemaining === NOTIFICATION_THRESHOLD_MINUTES) {
          await sendNotification(
            client,
            submission,
            `⏰ NCAP **${submission.id}** expires in 1 hour. Cast your vote now!`
          );
        }
      }

      const timerCalc = calculateDynamicTimer(
        submission.initialTimerMinutes,
        submission.approveVotes,
        submission.objectVotes,
        submission.approverPool.memberIds.length
      );

      // Wall-clock NATURAL_APPROVAL: fires when remaining time ≤ 25% of initial timer
      // and no vote-driven gantry is active.
      const expiresAt = submission.expiresAt?.getTime() ?? Date.now();
      const remainingMs = expiresAt - Date.now();
      const naturalGantryMs = submission.initialTimerMinutes * 60000 * TIMER_CONSTANTS.NATURAL_GANTRY_THRESHOLD;
      if (timerCalc.gantryState === GantryState.NONE && remainingMs > 0 && remainingMs <= naturalGantryMs) {
        timerCalc.gantryState = GantryState.NATURAL_APPROVAL;
        timerCalc.gantryExpiresAt = new Date(expiresAt);
      }

      const oldGantryState = submission.timerCalculation.gantryState;
      if (timerCalc.gantryState !== oldGantryState) {
        await handleGantryTransition(
          client,
          submission,
          oldGantryState,
          timerCalc.gantryState
        );
      }
      db.updateSubmission({ ...submission, timerCalculation: timerCalc });

      // Update Discord embed with new calculations
      const message = await getSubmissionMessage(client, submission);
      if (message) {
        const embed = createNcapTimerEmbed(submission, timerCalc);
        try {
          await message.edit({ embeds: [embed] });
        } catch (e) {
          console.error(`Failed to update message for ${submission.id}:`, e);
        }
      }
    }
  } catch (error) {
    console.error("[NCAP Timer Service] Check Error:", error);
  }
}

/**
 * Handle NCAP submission expiration
 */
async function processExpiration(
  client: BotClient,
  db: NcapDatabaseManager,
  submission: NcapSubmission
) {
  console.log(`[NCAP Timer Service] Processing expiration: ${submission.id}`);

  try {
    // Get final vote counts
    const approveCount = submission.approveVotes.length;
    const objectCount = submission.objectVotes.length;
    const totalVotes = approveCount + objectCount;

    // Determine outcome based on Rule 49(4)
    let finalStatus = "approved"; // Default: Approved (Natural Approval)
    let statusReason = "Natural Approval - No objections raised";

    if (totalVotes > 0) {
      const approvalRate = approveCount / totalVotes;
      
      // Check if objection reached veto threshold (20%)
      if (objectCount / totalVotes >= 0.2) {
        finalStatus = "rejected";
        statusReason = "Veto Pool Activated - 20%+ objections raised (Rule 49(4)(a))";
      }
      // Check for supermajority bypass (75%+)
      else if (approvalRate >= 0.75) {
        finalStatus = "approved";
        statusReason = "Supermajority Approval - 75%+ approved (Rule 49(3)(c))";
      }
    }

    const nextStatus = finalStatus === "approved" ? NcapStatus.APPROVED : NcapStatus.BLOCKED;
    db.updateSubmission({
      ...submission,
      status: nextStatus,
      resolvedAt: new Date(),
      outcome: finalStatus === "approved" ? "approved" : "blocked",
      outcomeReason: statusReason,
    });

    // Log audit entry
    db.addAuditLog({
      postId: submission.id,
      eventType: "expiration",
      actorName: "system",
      timestamp: new Date(),
      details: {
        finalStatus,
        approveCount,
        objectCount,
        totalVotes,
        reason: statusReason,
      },
    });

    // Update Discord message
    const message = await getSubmissionMessage(client, submission);
    if (message) {
      const finalColor = finalStatus === "approved" ? 0x00aa00 : 0xff4444;
      const finalEmbed = new EmbedBuilder()
        .setTitle(
          `✅ NCAP ${finalStatus === "approved" ? "APPROVED" : "REJECTED"}`
        )
        .setDescription(
          `**${submission.id}**: ${submission.title}\n\n${statusReason}`
        )
        .addFields({
          name: "Final Vote",
          value: `${approveCount} Approvals / ${objectCount} Objections`,
          inline: true,
        })
        .setColor(finalColor)
        .setTimestamp();

      try {
        await message.edit({ embeds: [finalEmbed], components: [] });
      } catch (e) {
        console.error(`Failed to update final message for ${submission.id}:`, e);
      }
    }

    // Send notification
    const notificationText =
      finalStatus === "approved"
        ? `✅ NCAP **${submission.id}** has been **APPROVED** - ${statusReason}`
        : `❌ NCAP **${submission.id}** has been **REJECTED** - ${statusReason}`;

    await sendNotification(client, submission, notificationText);
  } catch (error) {
    console.error(`[NCAP Timer Service] Expiration Error for ${submission.id}:`, error);
  }
}

/**
 * Handle gantry state transitions
 */
async function handleGantryTransition(
  client: BotClient,
  submission: NcapSubmission,
  oldState: GantryState,
  newState: GantryState
) {
  console.log(
    `[NCAP Timer Service] Gantry Transition: ${submission.id} ${oldState} → ${newState}`
  );

  try {
    // Send notification based on transition type
    let notificationText = "";

    if (newState === GantryState.NATURAL_APPROVAL) {
      notificationText = `🟢 NCAP **${submission.id}** entered **Natural Approval** - approval likely (Rule 49(3)(a))`;
    } else if (newState === GantryState.OBJECTION) {
      notificationText = `🔴 NCAP **${submission.id}** entered **Objection Gantry** - timer extended to 2x (Rule 49(3)(b))`;
    }

    if (notificationText) {
      await sendNotification(client, submission, notificationText);
    }
  } catch (error) {
    console.error(
      `[NCAP Timer Service] Gantry Transition Error for ${submission.id}:`,
      error
    );
  }
}

/**
 * Get the Discord message for an NCAP submission
 */
async function getSubmissionMessage(client: BotClient, submission: NcapSubmission): Promise<Message | null> {
  try {
    if (!submission.messageId || !submission.channelId) {
      return null;
    }

    const channel = await client.channels.fetch(submission.channelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      return null;
    }

    const message = await channel.messages.fetch(submission.messageId);
    return message || null;
  } catch (error) {
    console.error(`Failed to fetch message for ${submission.id}:`, error);
    return null;
  }
}

/**
 * Send notification to NCAP alerts channel
 */
async function sendNotification(
  client: BotClient,
  submission: NcapSubmission,
  message: string
) {
  try {
    const channel = client.channels.cache.find(
      (c) => "name" in c && c.name === "ncap-alerts"
    );
    if (channel && channel.isTextBased() && "send" in channel) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setDescription(message)
            .setColor(0x0099ff)
            .setTimestamp(),
        ],
      });
    }
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

/**
 * Create embed showing current timer state
 */
function createNcapTimerEmbed(submission: NcapSubmission, timerCalc: ReturnType<typeof calculateDynamicTimer>): EmbedBuilder {
  const approveCount = submission.approveVotes.length;
  const objectCount = submission.objectVotes.length;
  const totalVotes = approveCount + objectCount;

  const approvalRate =
    totalVotes > 0 ? ((approveCount / totalVotes) * 100).toFixed(1) : "0.0";
  const objectionRate =
    totalVotes > 0 ? ((objectCount / totalVotes) * 100).toFixed(1) : "0.0";

  const timeRemaining = Math.ceil(
    ((submission.expiresAt?.getTime() ?? Date.now()) - Date.now()) / (1000 * 60)
  );

  const GANTRY_COLORS: Record<GantryState, number> = {
    [GantryState.NONE]: 0xffa500,
    [GantryState.NATURAL_APPROVAL]: 0x90ee90,
    [GantryState.VOTED_APPROVAL]: 0xffa500,
    [GantryState.OBJECTION]: 0xff4444,
  };

  let gantryStatus = "🟠 Voted Approval";
  if (timerCalc.gantryState === GantryState.NATURAL_APPROVAL) {
    gantryStatus = "🟢 Natural Approval";
  } else if (timerCalc.gantryState === GantryState.OBJECTION) {
    gantryStatus = "🔴 Objection Gantry";
  }

  return new EmbedBuilder()
    .setTitle(`NCAP: ${submission.title}`)
    .setDescription(submission.description)
    .setColor(GANTRY_COLORS[timerCalc.gantryState] || 0xffa500)
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
        name: "⏱️ Time Remaining",
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
        value: `Base: ${timerCalc.initialTimerMinutes}m → Current: ${Math.round(timerCalc.currentTimerMinutes)}m\nModifier: ${timerCalc.timerModifier.toFixed(2)}x`,
        inline: false,
      }
    );
}

function getMinutesRemaining(submission: NcapSubmission): number {
  const expiresAt = submission.expiresAt?.getTime() ?? Date.now();
  return Math.ceil((expiresAt - Date.now()) / (1000 * 60));
}

export { isBusinessHours };
