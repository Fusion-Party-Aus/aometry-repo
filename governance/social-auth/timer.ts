/**
 * Social Auth Timer Service
 * Background task that recalculates timers/gantry state for pending #auth-socmed
 * submissions, detects gantry transitions, and posts reminder notifications.
 *
 * Notification deduplication is persisted in the DB (auth_post_threshold_notifications)
 * so reminders are not re-sent after a bot restart.
 */

import { BotClient } from "@/types/discord";
import { EmbedBuilder } from "discord.js";
import { SocialAuthDatabaseManager } from "./database";
import { updateSubmissionTimer, getTimeRemaining } from "./calculator";
import { AuthPostStatus, GantryState, TIMER_CONSTANTS } from "./types";

const CHECK_INTERVAL_MS = TIMER_CONSTANTS.UPDATE_INTERVAL_MS;

export function startSocialAuthTimerService(client: BotClient) {
  console.log("[Social Auth Timer Service] Started background timer service");

  void safeCheck(client);
  setInterval(() => {
    void safeCheck(client);
  }, CHECK_INTERVAL_MS);
}

async function safeCheck(client: BotClient) {
  try {
    await checkPendingSubmissions(client);
  } catch (error) {
    console.error("[Social Auth Timer Service] Check failed:", error);
  }
}

async function checkPendingSubmissions(client: BotClient) {
  const db = new SocialAuthDatabaseManager();
  const active = db.getActiveSubmissions();

  for (const submission of active) {
    if (submission.status !== AuthPostStatus.PENDING) continue;

    const prevGantry = submission.timerCalculation.gantryState;
    const updated = updateSubmissionTimer(submission);
    const remaining = getTimeRemaining(updated);

    if (remaining <= 0) {
      // Timer expired - block the submission.
      const blocked = {
        ...updated,
        status: AuthPostStatus.BLOCKED,
        resolvedAt: new Date(),
        outcome: "blocked" as const,
        outcomeReason: "Timer expired without reaching required approvals",
      };
      db.atomicResolve(blocked, {
        postId: submission.id,
        eventType: "expiration",
        timestamp: new Date(),
        details: { approveCount: submission.approveVotes.length, requiredApprovals: submission.requiredApprovals },
      });
      await notifyChannel(
        client, submission.channelId, submission.messageId,
        `⏱️ **${submission.id}** expired without reaching its required approvals and has been blocked. Re-submit or escalate if still needed.`
      );
      continue;
    }

    // Persist updated timer state.
    db.updateSubmission(updated);

    // Notify on gantry transitions.
    const newGantry = updated.timerCalculation.gantryState;
    if (newGantry !== prevGantry) {
      await handleGantryTransition(client, submission, prevGantry, newGantry);
      db.addAuditLog({
        postId: submission.id,
        eventType: "gantry_entry",
        timestamp: new Date(),
        details: { from: prevGantry, to: newGantry },
      });
    }

    // Send reminders for approaching expiration thresholds (DB-deduped across restarts).
    for (const threshold of TIMER_CONSTANTS.REMINDER_THRESHOLDS) {
      if (remaining <= threshold && !db.hasNotifiedThreshold(submission.id, threshold)) {
        db.setNotifiedThreshold(submission.id, threshold);
        await notifyChannel(
          client, submission.channelId, submission.messageId,
          `⏰ **${submission.id}** expires in ~${remaining} minutes ` +
          `(${submission.approveVotes.length}/${submission.requiredApprovals} approvals). ` +
          `<@${submission.submitterId}>`
        );
      }
    }
  }
}

async function handleGantryTransition(
  client: BotClient,
  submission: { id: string; channelId: string; messageId: string },
  from: GantryState,
  to: GantryState
) {
  const messages: Partial<Record<GantryState, string>> = {
    [GantryState.NATURAL_APPROVAL]: `🟢 **${submission.id}** entered **Natural Approval** gantry — less than 25% of timer remaining.`,
    [GantryState.VOTED_APPROVAL]:   `🟠 **${submission.id}** entered **Voted Approval** gantry — votes have reduced the timer to its floor.`,
    [GantryState.OBJECTION]:        `🔴 **${submission.id}** entered **Objection Gantry** — objections have extended the timer to its ceiling.`,
  };
  const text = messages[to];
  if (text) {
    console.log(`[Social Auth Timer] Gantry ${submission.id}: ${from} → ${to}`);
    await notifyChannel(client, submission.channelId, submission.messageId, text);
  }
}

async function notifyChannel(client: BotClient, channelId: string, messageId: string, text: string) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    await channel.send({
      embeds: [new EmbedBuilder().setDescription(text).setColor(0xe0a040)],
      reply: messageId ? { messageReference: messageId } : undefined,
    });
  } catch (error) {
    console.error("[Social Auth Timer Service] Notification failed:", error);
  }
}
