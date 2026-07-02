import { describe, it, expect } from 'vitest';
import { parseYoutubeFeedXml, findNewVideos } from './calculator';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx"/>
  <id>yt:channel:UCxxx</id>
  <yt:channelId>UCxxx</yt:channelId>
  <title>Fusion Party Australia</title>
  <entry>
    <id>yt:video:AAA111</id>
    <yt:videoId>AAA111</yt:videoId>
    <yt:channelId>UCxxx</yt:channelId>
    <title>Newest Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AAA111"/>
    <published>2026-06-02T10:00:00+00:00</published>
    <updated>2026-06-02T10:05:00+00:00</updated>
  </entry>
  <entry>
    <id>yt:video:BBB222</id>
    <yt:videoId>BBB222</yt:videoId>
    <yt:channelId>UCxxx</yt:channelId>
    <title>Older Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=BBB222"/>
    <published>2026-06-01T10:00:00+00:00</published>
    <updated>2026-06-01T10:05:00+00:00</updated>
  </entry>
</feed>`;

describe('parseYoutubeFeedXml', () => {
  it('extracts every entry from a well-formed feed', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    expect(entries).toHaveLength(2);
  });

  it('extracts videoId, title, publishedAt, and link for each entry', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    const newest = entries.find(e => e.videoId === 'AAA111')!;
    expect(newest.title).toBe('Newest Video');
    expect(newest.link).toBe('https://www.youtube.com/watch?v=AAA111');
    expect(newest.publishedAt.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });

  it('returns an empty array for a feed with no entries', () => {
    const empty = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>`;
    expect(parseYoutubeFeedXml(empty)).toEqual([]);
  });

  it('returns an empty array for malformed/non-feed input', () => {
    expect(parseYoutubeFeedXml('not xml at all')).toEqual([]);
    expect(parseYoutubeFeedXml('')).toEqual([]);
  });

  it('skips an entry missing a required field rather than throwing', () => {
    const missingId = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>No Video ID Here</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=ZZZ"/>
        <published>2026-01-01T00:00:00+00:00</published>
      </entry>
    </feed>`;
    expect(() => parseYoutubeFeedXml(missingId)).not.toThrow();
    expect(parseYoutubeFeedXml(missingId)).toEqual([]);
  });
});

describe('findNewVideos', () => {
  it('returns videos not present in the announced set', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    const result = findNewVideos(entries, new Set());
    expect(result).toHaveLength(2);
  });

  it('excludes videos already in the announced set', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    const result = findNewVideos(entries, new Set(['BBB222']));
    expect(result.map(e => e.videoId)).toEqual(['AAA111']);
  });

  it('returns an empty array when every video has already been announced', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    const result = findNewVideos(entries, new Set(['AAA111', 'BBB222']));
    expect(result).toEqual([]);
  });

  it('sorts new videos oldest-first, so they are announced in upload order', () => {
    const entries = parseYoutubeFeedXml(SAMPLE_FEED);
    const result = findNewVideos(entries, new Set());
    expect(result.map(e => e.videoId)).toEqual(['BBB222', 'AAA111']);
  });

  it('returns an empty array for an empty entries list', () => {
    expect(findNewVideos([], new Set())).toEqual([]);
  });
});
