/**
 * /authqueue slash command
 * Shows pending, in-edit, approved, and failed submissions at a glance.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { BotClient, Command } from "@/types/discord";
import { SocialAuthDatabaseManager } from "./database";
import { SocialAuthSubmission, AuthPostStatus } from "./types";

export type QueueGroups = Record<AuthPostStatus, SocialAuthSubmission[]>;

/**
 * Format a single submission as a compact queue line.
 */
export function formatQueueEntry(sub: SocialAuthSubmission): string {
  const approves = sub.approveVotes.length;
  const objects = sub.objectVotes.length;
  const objStr = objects > 0 ? ` ❌${objects}` : '';
  const destinations = sub.destinations.join(', ');
  return `**${sub.id}** — <@${sub.submitterId}> | ${sub.sensitivity} | ${approves}/${sub.requiredApprovals}${objStr} | ${destinations}`;
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
    if (groups[sub.status]) {
      groups[sub.status].push(sub);
    }
  }

  for (const group of Object.values(groups)) {
    group.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  }

  return groups;
}

const ACTIVE_STATUSES: AuthPostStatus[] = [
  AuthPostStatus.PENDING,
  AuthPostStatus.IN_EDIT,
  AuthPostStatus.APPROVED,
  AuthPostStatus.PUBLISH_FAILED,
];

async function execute({ interaction, client: _client }: { interaction: ChatInputCommandInteraction; client: BotClient }) {
  await interaction.deferReply({ ephemeral: true });

  const db = new SocialAuthDatabaseManager();

  const allActive: SocialAuthSubmission[] = [];
  for (const status of ACTIVE_STATUSES) {
    allActive.push(...db.getSubmissionsInState(status));
  }

  const groups = groupSubmissionsByStatus(allActive);

  const embed = new EmbedBuilder()
    .setTitle('📋 Auth Post Queue')
    .setColor(0x5c9de0)
    .setTimestamp();

  const sections: { label: string; status: AuthPostStatus; emoji: string }[] = [
    { label: 'Pending — awaiting votes', status: AuthPostStatus.PENDING, emoji: '🟠' },
    { label: 'In Edit — waiting for resubmit', status: AuthPostStatus.IN_EDIT, emoji: '✏️' },
    { label: 'Approved — awaiting publish', status: AuthPostStatus.APPROVED, emoji: '✅' },
    { label: 'Publish Failed — needs retry', status: AuthPostStatus.PUBLISH_FAILED, emoji: '❌' },
  ];

  let hasAny = false;
  for (const { label, status, emoji } of sections) {
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

  return interaction.editReply({ embeds: [embed] });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('authqueue')
    .setDescription('Show the current #auth-socmed submission queue'),
  execute: execute as Command['execute'],
};

export default command;
