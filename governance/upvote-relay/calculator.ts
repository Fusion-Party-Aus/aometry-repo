/**
 * Upvote Relay calculation engine — pure functions, no network/Discord.js.
 */

import { BlueskyPost } from './types';

function extractRkey(uri: string): string | null {
  const parts = uri.split('/');
  const rkey = parts[parts.length - 1];
  return rkey || null;
}

/**
 * Parse a Bluesky `app.bsky.feed.getAuthorFeed` response into normalised posts.
 * Defensive against malformed/missing fields — skips a bad entry rather than throwing,
 * same convention as youtube-announcements' feed parser.
 */
export function parseBlueskyFeed(data: unknown, handle: string): BlueskyPost[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { feed?: unknown }).feed)) {
    return [];
  }

  const posts: BlueskyPost[] = [];
  for (const item of (data as { feed: unknown[] }).feed) {
    const post = (item as { post?: any })?.post;
    const uri = post?.uri;
    const text = post?.record?.text;
    const createdAtRaw = post?.record?.createdAt;

    if (typeof uri !== 'string' || typeof text !== 'string' || typeof createdAtRaw !== 'string') continue;

    const createdAt = new Date(createdAtRaw);
    if (isNaN(createdAt.getTime())) continue;

    const rkey = extractRkey(uri);
    if (!rkey) continue;

    posts.push({
      uri,
      postUrl: `https://bsky.app/profile/${handle}/post/${rkey}`,
      authorHandle: handle,
      text,
      createdAt,
    });
  }

  return posts;
}

/** Posts not yet in the relayed set, sorted oldest-first so they relay in post order. */
export function findNewPosts(posts: BlueskyPost[], relayedUris: ReadonlySet<string>): BlueskyPost[] {
  return posts
    .filter(p => !relayedUris.has(p.uri))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
