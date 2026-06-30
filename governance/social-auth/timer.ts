/**
 * Social Auth Timer Service
 * Background task that recalculates timers/gantry state for pending #auth-socmed
 * submissions and posts reminder notifications before expiration.
 */

import { BotClient } from "@/types/discord";
import { EmbedBuilder } from "discord.js";
import { SocialAuthDatabaseManager } from "./database";
import { updateSubmissionTimer, getTimeRemaining } from "./calculator";
import { AuthPostStatus, TIMER_CONSTANTS } from "./types";

const CHECK_INTERVAL_MS = TIMER_CONSTANTS.UPDATE_INTERVAL_MS;
const notifiedThresholds = new Map<string, Set<number>>();

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

    const updated = updateSubmissionTimer(submission);
    db.updateSubmission(updated);

    const remaining = getTimeRemaining(updated);

    if (remaining <= 0) {
      // Timer expired without enough approvals - blocked, not silently published.
      const blocked = {
        ...updated,
        status: AuthPostStatus.BLOCKED,
        resolvedAt: new Date(),
        outcome: "blocked" as const,
        outcomeReason: "Timer expired without reaching required approvals",
      };
      db.updateSubmission(blocked);
      db.addAuditLog({
        postId: submission.id,
        eventType: "expiration",
        timestamp: new Date(),
        details: { approveCount: submission.approveVotes.length, requiredApprovals: submission.requiredApprovals },
      });

      await notifyChannel(client, submission.channelId, submission.messageId,
        `⏱️ **${submission.id}** expired without reaching its required approvals and has been blocked. Re-submit or escalate if still needed.`);
      notifiedThresholds.delete(submission.id);
      continue;
    }

    for (const threshold of TIMER_CONSTANTS.REMINDER_THRESHOLDS) {
      if (remaining <= threshold) {
        const sent = notifiedThresholds.get(submission.id) ?? new Set<number>();
        if (!sent.has(threshold)) {
          sent.add(threshold);
          notifiedThresholds.set(submission.id, sent);
          await notifyChannel(client, submission.channelId, submission.messageId,
            `⏰ **${submission.id}** expires in ~${remaining} minutes (${submission.approveVotes.length}/${submission.requiredApprovals} approvals). <@${submission.submitterId}>`);
        }
      }
    }
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
