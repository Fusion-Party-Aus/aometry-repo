/**
 * YouTube Announcements module type definitions.
 * Replaces Fusion Brain's (YAGPDB) YouTube-upload-to-#Announcements integration. Polls the
 * channel's public Atom feed (no API key required) rather than the YouTube Data API.
 */

/** A single video entry parsed from the channel's public Atom feed. */
export interface YoutubeVideoEntry {
  videoId: string;
  title: string;
  publishedAt: Date;
  link: string;
}
