/**
 * Events Calendar embed rendering — pure functions, no Discord side-effects.
 * formatEventEntry reproduces the structure of the manual's Appendix A "Detailed Event
 * Summary Template" (Chronicle Bot's Go template syntax) in plain TypeScript: title+link,
 * start time, duration/intended span (or "All Day Event"), then location if present.
 */

import { EmbedBuilder } from 'discord.js';
import { CalendarEvent } from './types';

function formatDuration(startTime: Date, endTime: Date | null): string {
  if (!endTime) return 'unspecified';
  const minutes = Math.round((endTime.getTime() - startTime.getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** One event's line(s) in the standing schedule embed — mirrors Appendix A's template shape. */
export function formatEventEntry(event: CalendarEvent): string {
  const titleLine = event.link ? `[${event.title}](${event.link})` : event.title;
  let entry = titleLine;

  if (event.allDay) {
    entry += `\n└ *All Day Event*`;
  } else {
    const startUnix = Math.floor(event.startTime.getTime() / 1000);
    entry += `\n└ **ST: <t:${startUnix}:t>** — Duration: **${formatDuration(event.startTime, event.endTime)}**`;
  }

  if (event.location) {
    entry += `\n└─ Location: ${event.location}`;
  }

  return entry;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * "Group By Day" summary style, per Appendix A: one field per calendar day, each listing
 * that day's events. Matches the manual's "Upcoming Event Schedule" (60-day window,
 * refreshed daily at 8:30am — window/refresh timing is timer.ts's job, this just renders
 * whatever list it's given).
 */
export function buildUpcomingEventScheduleEmbed(events: CalendarEvent[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🗓️ Upcoming Event Schedule')
    .setColor(0x5c9de0)
    .setTimestamp();

  if (events.length === 0) {
    embed.setDescription('No upcoming events in the next 60 days.');
    return embed;
  }

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.startTime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(event);
  }

  for (const [day, dayEvents] of [...byDay.entries()].sort()) {
    embed.addFields({
      name: day,
      value: dayEvents.map(formatEventEntry).join('\n\n').substring(0, 1024),
      inline: false,
    });
  }

  return embed;
}
