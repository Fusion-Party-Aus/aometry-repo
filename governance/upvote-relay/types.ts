/**
 * Upvote Relay module type definitions.
 * Replaces the "Fusion News" bot's webhook-post-mirroring into #upvote-this: watches the
 * party's public Bluesky feed and relays new posts as a reactable message, so members can
 * engage with (like/repost/quote) official posts without needing platform accounts.
 *
 * Scoped to Bluesky only — its AT Protocol API is fully public and free (no auth, no app
 * review). Twitter/X's API is paywalled and Facebook/Instagram's needs Graph API app
 * review, so neither is a "poll their public feed directly" candidate the way Bluesky is.
 */

/** A single post parsed from the Bluesky public getAuthorFeed API response. */
export interface BlueskyPost {
  uri: string; // e.g. at://did:plc:xxx/app.bsky.feed.post/<rkey> — used as the dedup key
  postUrl: string; // e.g. https://bsky.app/profile/<handle>/post/<rkey>
  authorHandle: string;
  text: string;
  createdAt: Date;
}
