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
    [AuthPostStatus.PUBLISHING]: [],
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

// Discord hard limits on embed fields.
const FIELD_VALUE_LIMIT = 1024;
const MAX_FIELDS = 25;

/**
 * Split an ordered list of formatted lines into field-value chunks that each stay
 * within Discord's 1024-char limit, without ever cutting a line in half.
 */
function chunkLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > FIELD_VALUE_LIMIT && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Build the queue EmbedBuilder from a list of active submissions.
 * Pure function — no Discord side-effects, fully testable.
 *
 * Oversized sections are split across multiple continuation fields rather than
 * truncated mid-entry; if the whole embed would exceed Discord's 25-field cap the
 * remainder is summarised with an explicit "+N more" overflow indicator.
 */
export function buildQueueEmbed(submissions: SocialAuthSubmission[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📋 Auth Post Queue')
    .setColor(0x5c9de0)
    .setTimestamp();

  const groups = groupSubmissionsByStatus(submissions);
  const fields: { name: string; value: string; inline: boolean }[] = [];
  let overflow = 0;

  for (const { label, status, emoji } of SECTIONS) {
    const items = groups[status];
    if (items.length === 0) continue;

    const chunks = chunkLines(items.map(formatQueueEntry));
    chunks.forEach((chunk, idx) => {
      const name = idx === 0
        ? `${emoji} ${label} (${items.length})`
        : `${emoji} ${label} (cont.)`;
      fields.push({ name, value: chunk, inline: false });
    });
  }

  // Reserve one field slot for the overflow marker when we run past Discord's cap.
  if (fields.length > MAX_FIELDS) {
    const kept = fields.slice(0, MAX_FIELDS - 1);
    const dropped = fields.slice(MAX_FIELDS - 1);
    overflow = dropped.reduce((n, f) => n + f.value.split('\n').length, 0);
    kept.push({ name: '…', value: `+${overflow} more not shown`, inline: false });
    embed.addFields(...kept);
  } else if (fields.length > 0) {
    embed.addFields(...fields);
  } else {
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
