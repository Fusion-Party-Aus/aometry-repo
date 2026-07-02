/**
 * Comms Calendar Discord glue. Thin by design — the date-window logic lives in
 * calculator.ts and the rendering in embed.ts, both fully unit-tested; this file only
 * finds/creates the standing #comms-cal message and keeps it refreshed. Not unit-tested,
 * per this repo's convention for Discord.js-bound handlers (see CLAUDE.md).
 */

import { BotClient } from "@/types/discord";
import { CommsCalendarDatabaseManager } from "./database";
import { getUpcomingSignificantDays } from "./calculator";
import { buildCommsCalendarEmbed } from "./embed";
import { SIGNIFICANT_DAYS, WINDOW_DAYS } from "./config";

const MESSAGE_KEY = "comms_calendar_message_id";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily is enough for a weekly-granularity display.

/** Find or create the standing #comms-cal message, then start the daily refresh loop. */
export function startCommsCalendarService(client: BotClient) {
  const channelId = process.env.COMMS_CALENDAR_CHANNEL_ID;
  if (!channelId) {
    console.log("[Comms Calendar] COMMS_CALENDAR_CHANNEL_ID not set — service disabled.");
    return;
  }

  void initMessage(client, channelId).then(() => refreshMessage(client, channelId));
  setInterval(() => {
    void refreshMessage(client, channelId);
  }, CHECK_INTERVAL_MS);
}

async function initMessage(client: BotClient, channelId: string): Promise<void> {
  const db = new CommsCalendarDatabaseManager(client.databaseManager.getSqlite());

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      console.error("[Comms Calendar] Configured channel is not a text channel.");
      return;
    }

    const existingMsgId = db.getConfigValue(MESSAGE_KEY);
    if (existingMsgId) {
      try {
        await channel.messages.fetch(existingMsgId);
        return; // Reuse — refreshMessage() will update it.
      } catch {
        // Message was deleted — fall through to create a new one.
      }
    }

    const embed = buildCommsCalendarEmbed([]);
    const msg = await channel.send({ embeds: [embed] });
    db.setConfigValue(MESSAGE_KEY, msg.id);
  } catch (error) {
    console.error("[Comms Calendar] Failed to init standing message:", error);
  }
}

async function refreshMessage(client: BotClient, channelId: string): Promise<void> {
  const db = new CommsCalendarDatabaseManager(client.databaseManager.getSqlite());
  const messageId = db.getConfigValue(MESSAGE_KEY);
  if (!messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) return;

    const upcoming = getUpcomingSignificantDays(new Date(), SIGNIFICANT_DAYS, WINDOW_DAYS);
    const embed = buildCommsCalendarEmbed(upcoming);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [embed] });
  } catch (error) {
    console.error("[Comms Calendar] Failed to refresh standing message:", error);
  }
}
