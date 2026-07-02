/**
 * Events Calendar Discord glue. Thin by design — window/reminder/diff logic lives in
 * calculator.ts, rendering in embed.ts, both fully unit-tested; this file only polls
 * Google Calendar, keeps the standing embed fresh, and pings @Tuned. Not unit-tested,
 * per this repo's convention for Discord.js-bound handlers (see CLAUDE.md).
 *
 * Configuration (environment variables on the host bot):
 *   EVENTS_CALENDAR_CHANNEL_ID — Discord channel for the "Upcoming Event Schedule" embed
 *   TUNED_ROLE_ID              — role pinged on event created/changed and 15-min reminders
 *   See googleCalendar.ts for the Google Calendar credentials.
 *
 * Simplification vs. the manual: Chronicle Bot refreshes the schedule embed once daily at
 * 8:30am. This polls every 5 minutes instead — the embed is cheap to rebuild and staying
 * fresher only improves accuracy, so the exact once-daily cadence wasn't worth replicating.
 */

import { BotClient } from "@/types/discord";
import { GuildScheduledEvent } from "discord.js";
import { EventsCalendarDatabaseManager } from "./database";
import { fetchGoogleCalendarEvents, pushEventToGoogleCalendar } from "./googleCalendar";
import { getUpcomingEvents, isEventReminderDue, detectEventChanges } from "./calculator";
import { buildUpcomingEventScheduleEmbed, formatEventEntry } from "./embed";
import { CalendarEvent } from "./types";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULE_WINDOW_DAYS = 60; // "Displays all events for the next 60 days."
const REMINDER_MINUTES_BEFORE = 15;
const SCHEDULE_MESSAGE_KEY = "events_calendar_message_id";

/** Start the poll loop: refreshes the standing schedule embed and pings @Tuned as needed. */
export function startEventsCalendarService(client: BotClient) {
  const channelId = process.env.EVENTS_CALENDAR_CHANNEL_ID;
  if (!channelId) {
    console.log("[Events Calendar] EVENTS_CALENDAR_CHANNEL_ID not set — service disabled.");
    return;
  }

  void tick(client, channelId);
  setInterval(() => {
    void tick(client, channelId);
  }, POLL_INTERVAL_MS);
}

async function tick(client: BotClient, channelId: string) {
  try {
    const db = new EventsCalendarDatabaseManager(client.databaseManager.getSqlite());
    const now = new Date();

    const allEvents = await fetchGoogleCalendarEvents();
    const previousEvents = db.getKnownEvents();
    const { created, changed } = detectEventChanges(previousEvents, allEvents);
    db.saveKnownEvents(allEvents);

    const tunedRoleId = process.env.TUNED_ROLE_ID;
    for (const event of [...created, ...changed]) {
      await notifyChannel(
        client, channelId,
        `${tunedRoleId ? `<@&${tunedRoleId}> ` : ""}📅 ${created.includes(event) ? "New event" : "Event updated"}: ${formatEventEntry(event)}`
      );
    }

    const upcoming = getUpcomingEvents(allEvents, now, SCHEDULE_WINDOW_DAYS);
    for (const event of upcoming) {
      if (isEventReminderDue(event, now, REMINDER_MINUTES_BEFORE) && !db.hasBeenReminded(event.id)) {
        db.markReminded(event.id);
        await notifyChannel(
          client, channelId,
          `${tunedRoleId ? `<@&${tunedRoleId}> ` : ""}⏰ Starting soon: ${formatEventEntry(event)}`
        );
      }
    }

    await refreshScheduleEmbed(client, channelId, db, upcoming);
  } catch (error) {
    console.error("[Events Calendar] Tick failed:", error);
  }
}

async function refreshScheduleEmbed(
  client: BotClient, channelId: string, db: EventsCalendarDatabaseManager, upcoming: CalendarEvent[]
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const embed = buildUpcomingEventScheduleEmbed(upcoming);
  const existingMsgId = db.getConfigValue(SCHEDULE_MESSAGE_KEY);
  if (existingMsgId) {
    try {
      const msg = await channel.messages.fetch(existingMsgId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // Message was deleted — fall through to create a new one.
    }
  }

  const msg = await channel.send({ embeds: [embed] });
  db.setConfigValue(SCHEDULE_MESSAGE_KEY, msg.id);
}

async function notifyChannel(client: BotClient, channelId: string, text: string) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    await channel.send({ content: text });
  } catch (error) {
    console.error("[Events Calendar] Notification failed:", error);
  }
}

/**
 * Call from the host's guildScheduledEventCreate/Update listener (Event Feed direction:
 * Discord -> Google). Converts a Discord scheduled event to our CalendarEvent shape and
 * pushes it to Google Calendar.
 */
export async function handleDiscordEventChange(event: GuildScheduledEvent): Promise<void> {
  const calendarEvent: CalendarEvent = {
    id: event.id,
    title: event.name,
    description: event.description ?? null,
    location: event.entityMetadata?.location ?? null,
    startTime: event.scheduledStartAt ?? new Date(),
    endTime: event.scheduledEndAt ?? null,
    allDay: false,
    link: event.url ?? null,
    source: "discord",
  };

  const result = await pushEventToGoogleCalendar(calendarEvent);
  if (!result.success) {
    console.error(`[Events Calendar] Failed to push "${event.name}" to Google Calendar: ${result.error}`);
  }
}
