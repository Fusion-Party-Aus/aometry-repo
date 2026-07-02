/**
 * Comms Calendar embed rendering — pure function, no Discord side-effects, fully testable.
 */

import { EmbedBuilder } from 'discord.js';
import { UpcomingSignificantDay } from './types';

function formatEntry(item: UpcomingSignificantDay): string {
  const dateStr = item.date.toISOString().slice(0, 10);
  const line = `**${item.day.name}** — ${dateStr}`;
  return item.day.description ? `${line}\n${item.day.description}` : line;
}

/** Build the #comms-cal standing embed from the days upcoming in the configured window. */
export function buildCommsCalendarEmbed(upcoming: UpcomingSignificantDay[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('📅 Comms Calendar — Upcoming Days of Significance')
    .setColor(0x5c9de0)
    .setTimestamp();

  if (upcoming.length === 0) {
    embed.setDescription('No upcoming days of significance in the next week.');
    return embed;
  }

  embed.setDescription(upcoming.map(formatEntry).join('\n\n'));
  return embed;
}
