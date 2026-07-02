/**
 * YouTube Announcements calculation engine — pure functions, no network/Discord.js.
 */

import { YoutubeVideoEntry } from './types';

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : null;
}

/**
 * Parse a YouTube channel Atom feed (as returned by
 * https://www.youtube.com/feeds/videos.xml?channel_id=...) into video entries.
 * Regex-based rather than a full XML parser — the feed format is small and stable, and
 * this avoids a parser dependency. An entry missing any required field, or with an
 * unparseable date, is silently skipped rather than throwing.
 */
export function parseYoutubeFeedXml(xml: string): YoutubeVideoEntry[] {
  const entries: YoutubeVideoEntry[] = [];
  const entryBlocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

  for (const block of entryBlocks) {
    const videoId = extractTag(block, 'yt:videoId');
    const title = extractTag(block, 'title');
    const published = extractTag(block, 'published');
    const linkMatch = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : null;

    if (!videoId || !title || !published || !link) continue;

    const publishedAt = new Date(published);
    if (isNaN(publishedAt.getTime())) continue;

    entries.push({ videoId, title, publishedAt, link });
  }

  return entries;
}

/** Videos not yet in the announced set, sorted oldest-first so they post in upload order. */
export function findNewVideos(
  entries: YoutubeVideoEntry[],
  announcedVideoIds: ReadonlySet<string>
): YoutubeVideoEntry[] {
  return entries
    .filter(e => !announcedVideoIds.has(e.videoId))
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
}
