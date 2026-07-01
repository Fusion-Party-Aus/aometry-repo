/**
 * Social Auth standing queue message.
 * The bot maintains a single live-updated embed in QUEUE_CHANNEL_ID that reflects
 * the current state of all active submissions. It is refreshed after every interaction
 * (vote, approve, edit, publish, withdraw) and on each timer tick.
 *
 * On startup call initQueueMessage(client) to create or locate the standing message.
 * Thereafter call refreshQueueMessage(client) wherever state changes.
 */

import { BotClient } from "@/types/discord";
import { EmbedBuilder } from "discord.js";
import { SocialAuthDatabaseManager } from "./database";
import { SocialAuthSubmission, AuthPostStatus } from "./types";

export type QueueGroups = Record<AuthPostStatus, SocialAuthSubmission[]>;

const QUEUE_MESSAGE_KEY = 'queue_message_id';
const QUEUE_CHANNEL_KEY = 'queue_channel_id';

const ACTIVE_STATUSES: AuthPostStatus[] = [
  AuthPostStatus.PENDING,
  AuthPostStatus.IN_EDIT,
  AuthPostStatus.APPROVED,
  AuthPostStatus.PUBLISH_FAILED,
];

const SECTIONS: { label: string; status: AuthPostStatus; emoji: string }[] = [
  { label: 'Pending — awaiting votes',      status: AuthPostStatus.PENDING,       emoji: '🟠' },
  { label: 'In Edit — waiting for resubmit', status: AuthPostStatus.IN_EDIT,       emoji: '✏️' },
  { label: 'Approved — awaiting publish',   status: AuthPostStatus.APPROVED,      emoji: '✅' },
  { label: 'Publish Failed — needs retry',  status: AuthPostStatus.PUBLISH_FAILED, emoji: '❌' },
];

/**
 * Format a single submission as a compact queue line.
 */
export function formatQueueEntry(sub: SocialAuthSubmission): string {
  const approves = sub.approveVotes.length;
  const objects = sub.objectVotes.length;
  const objStr = objects > 0 ? ` ❌${objects}` : '';
  return `**${sub.id}** — <@${sub.submitterId}> | ${sub.sensitivity} | ${approves}/${sub.requiredApprovals}${objStr} | ${sub.destinations.join(', ')}`;
}

/**
 * Group submissions by status, sorting each group oldest-first.
 */
export function groupSubmissionsByStatus(submissions: SocialAuthSubmission[]): QueueGroups {
  const groups: QueueGroups = {
    [AuthPostStatus.PENDING]: [],
    [AuthPostStatus.IN_EDIT]: [],
    [AuthPostStatus.APPROVED]: [],
    [AuthPostStatus.PUBLISHED]: [],
    [AuthPostStatus.PUBLISH_FAILED]: [],
    [AuthPostStatus.BLOCKED]: [],
    [AuthPostStatus.WITHDRAWN]: [],
  };

  for (const sub of submissions) {
    if (groups[sub.status]) groups[sub.status].push(sub);
  }

  for (const group of Object.values(groups)) {
    group.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  }

  return groups;
}

/**
 * Build the queue EmbedBuilder from a list of active submissions.
 * Pure function — no Discord side-effects, fully testable.
 */
export function buildQueueEmbed(submissions: SocialAuthSubmission[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📋 Auth Post Queue')
    .setColor(0x5c9de0)
    .setTimestamp();

  const groups = groupSubmissionsByStatus(submissions);
  let hasAny = false;

  for (const { label, status, emoji } of SECTIONS) {
    const items = groups[status];
    if (items.length === 0) continue;
    hasAny = true;
    embed.addFields({
      name: `${emoji} ${label} (${items.length})`,
      value: items.map(formatQueueEntry).join('\n').substring(0, 1024),
      inline: false,
    });
  }

  if (!hasAny) {
    embed.setDescription('✅ Queue is clear — no active submissions.');
  }

  return embed;
}

/**
 * Find or create the standing queue message in QUEUE_CHANNEL_ID.
 * Stores the message ID in the DB so it survives restarts.
 * Call once on bot startup before the first refreshQueueMessage.
 */
export async function initQueueMessage(client: BotClient): Promise<void> {
  const channelId = process.env.QUEUE_CHANNEL_ID;
  if (!channelId) {
    console.log('[Queue] QUEUE_CHANNEL_ID not set — standing queue message disabled.');
    return;
  }

  const db = new SocialAuthDatabaseManager();
  db.setConfigValue(QUEUE_CHANNEL_KEY, channelId);

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      console.error('[Queue] QUEUE_CHANNEL_ID channel is not a text channel.');
      return;
    }

    // Try to reuse an existing queue message from a previous run.
    const existingMsgId = db.getConfigValue(QUEUE_MESSAGE_KEY);
    if (existingMsgId) {
      try {
        await channel.messages.fetch(existingMsgId);
        // Message still exists — we'll just refresh it below.
        console.log(`[Queue] Reusing existing queue message ${existingMsgId}`);
        await refreshQueueMessage(client);
        return;
      } catch {
        // Message was deleted — create a new one.
      }
    }

    const embed = buildQueueEmbed([]);
    const msg = await channel.send({ embeds: [embed] });
    db.setConfigValue(QUEUE_MESSAGE_KEY, msg.id);
    console.log(`[Queue] Created standing queue message ${msg.id} in channel ${channelId}`);
  } catch (error) {
    console.error('[Queue] Failed to init queue message:', error);
  }
}

/**
 * Refresh the standing queue message with the latest active submissions.
 * Silent no-op if QUEUE_CHANNEL_ID is not configured or the message is missing.
 */
export async function refreshQueueMessage(client: BotClient): Promise<void> {
  const db = new SocialAuthDatabaseManager();
  const channelId = db.getConfigValue(QUEUE_CHANNEL_KEY) ?? process.env.QUEUE_CHANNEL_ID;
  const messageId = db.getConfigValue(QUEUE_MESSAGE_KEY);
  if (!channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const allActive: SocialAuthSubmission[] = [];
    for (const status of ACTIVE_STATUSES) {
      allActive.push(...db.getSubmissionsInState(status));
    }

    const embed = buildQueueEmbed(allActive);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [embed] });
  } catch (error) {
    console.error('[Queue] Failed to refresh queue message:', error);
  }
}
