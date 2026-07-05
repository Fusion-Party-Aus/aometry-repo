/**
 * Bluesky public feed integration. Uses the AT Protocol's public, unauthenticated
 * getAuthorFeed endpoint — no API key, no app review, no OAuth. Any Bluesky account's
 * public posts are readable this way.
 *
 * Configuration (environment variable on the host bot):
 *   BLUESKY_HANDLE — the account to watch, e.g. "fusionparty.bsky.social"
 */

const BLUESKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';

/** Fetch the most recent posts from a public Bluesky account's feed. */
export async function fetchAuthorFeed(handle: string, limit = 20): Promise<unknown> {
  const url = `${BLUESKY_PUBLIC_API}?actor=${encodeURIComponent(handle)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Bluesky feed fetch failed: ${res.status}`);
  }
  return res.json();
}
