/**
 * YouTube Announcements Discord/network glue. Thin by design — feed parsing and diffing
 * live in calculator.ts, rendering in embed.ts, both fully unit-tested; this file only
 * fetches the public feed on a timer and posts new videos. Not unit-tested, per this
 * repo's convention for Discord.js-bound handlers (see CLAUDE.md).
 *
 * Configuration (environment variables on the host bot):
 *   YOUTUBE_CHANNEL_ID       — the YouTube channel to poll (required)
 *   ANNOUNCEMENTS_CHANNEL_ID — Discord channel snowflake to post new videos in (required)
 * No YouTube API key needed — polls the channel's public Atom feed.
 */

import { BotClient } from "@/types/discord";
import { YoutubeAnnouncementsDatabaseManager } from "./database";
import { parseYoutubeFeedXml, findNewVideos } from "./calculator";
import { buildVideoAnnouncementEmbed } from "./embed";

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — frequent enough, well within YouTube's rate limits for a public feed fetch.

/** Start polling the configured YouTube channel's feed for new uploads. */
export function startYoutubeAnnouncementsService(client: BotClient) {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const announcementsChannelId = process.env.ANNOUNCEMENTS_CHANNEL_ID;
  if (!channelId || !announcementsChannelId) {
    console.log("[YouTube Announcements] YOUTUBE_CHANNEL_ID or ANNOUNCEMENTS_CHANNEL_ID not set — service disabled.");
    return;
  }

  void checkForNewVideos(client, channelId, announcementsChannelId);
  setInterval(() => {
    void checkForNewVideos(client, channelId, announcementsChannelId);
  }, POLL_INTERVAL_MS);
}

async function checkForNewVideos(client: BotClient, youtubeChannelId: string, announcementsChannelId: string) {
  try {
    const db = new YoutubeAnnouncementsDatabaseManager(client.databaseManager.getSqlite());
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`);
    if (!res.ok) {
      console.error(`[YouTube Announcements] Feed fetch failed: ${res.status}`);
      return;
    }
    const xml = await res.text();
    const entries = parseYoutubeFeedXml(xml);
    const newVideos = findNewVideos(entries, db.getAnnouncedVideoIds());
    if (newVideos.length === 0) return;

    const channel = await client.channels.fetch(announcementsChannelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      console.error("[YouTube Announcements] ANNOUNCEMENTS_CHANNEL_ID channel is not a text channel.");
      return;
    }

    for (const video of newVideos) {
      await channel.send({ embeds: [buildVideoAnnouncementEmbed(video)] });
      db.markAnnounced(video.videoId);
    }
  } catch (error) {
    console.error("[YouTube Announcements] Check failed:", error);
  }
}
