/**
 * Upvote Relay Discord/network glue. Thin by design — feed parsing and diffing live in
 * calculator.ts, fully unit-tested there; this file only polls the public feed on a timer
 * and posts new posts. Not unit-tested, per this repo's convention for Discord.js-bound
 * handlers (see CLAUDE.md).
 *
 * Posts the raw bsky.app URL rather than a custom-built embed — Discord natively unfurls
 * bsky.app links into a rich card (author, text, timestamp), matching how the previous
 * "Fusion News" bot's posts rendered. No embed-building logic needed here.
 *
 * Configuration (environment variables on the host bot):
 *   BLUESKY_HANDLE     — the account to watch (see bluesky.ts)
 *   UPVOTE_CHANNEL_ID  — Discord channel snowflake for #upvote-this
 */

import { BotClient } from "@/types/discord";
import { UpvoteRelayDatabaseManager } from "./database";
import { fetchAuthorFeed } from "./bluesky";
import { parseBlueskyFeed, findNewPosts } from "./calculator";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Start polling the configured Bluesky account's feed for new posts. */
export function startUpvoteRelayService(client: BotClient) {
  const handle = process.env.BLUESKY_HANDLE;
  const channelId = process.env.UPVOTE_CHANNEL_ID;
  if (!handle || !channelId) {
    console.log("[Upvote Relay] BLUESKY_HANDLE or UPVOTE_CHANNEL_ID not set — service disabled.");
    return;
  }

  void checkForNewPosts(client, handle, channelId);
  setInterval(() => {
    void checkForNewPosts(client, handle, channelId);
  }, POLL_INTERVAL_MS);
}

async function checkForNewPosts(client: BotClient, handle: string, channelId: string) {
  try {
    const db = new UpvoteRelayDatabaseManager(client.databaseManager.getSqlite());
    const feedData = await fetchAuthorFeed(handle);
    const posts = parseBlueskyFeed(feedData, handle);
    const newPosts = findNewPosts(posts, db.getRelayedUris());
    if (newPosts.length === 0) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      console.error("[Upvote Relay] UPVOTE_CHANNEL_ID channel is not a text channel.");
      return;
    }

    for (const post of newPosts) {
      await channel.send({ content: post.postUrl });
      db.markRelayed(post.uri);
    }
  } catch (error) {
    console.error("[Upvote Relay] Check failed:", error);
  }
}
