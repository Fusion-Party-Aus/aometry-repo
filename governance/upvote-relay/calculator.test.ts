import { describe, it, expect } from 'vitest';
import { parseBlueskyFeed, findNewPosts } from './calculator';

const HANDLE = 'fusionparty.bsky.social';

const SAMPLE_FEED = {
  feed: [
    {
      post: {
        uri: 'at://did:plc:abc123/app.bsky.feed.post/newest1',
        cid: 'bafynewest',
        author: { did: 'did:plc:abc123', handle: HANDLE, displayName: 'Fusion Party Australia' },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Newest post about the campaign launch.',
          createdAt: '2026-07-02T11:03:00.000Z',
        },
        indexedAt: '2026-07-02T11:03:01.000Z',
      },
    },
    {
      post: {
        uri: 'at://did:plc:abc123/app.bsky.feed.post/older1',
        cid: 'bafyolder',
        author: { did: 'did:plc:abc123', handle: HANDLE, displayName: 'Fusion Party Australia' },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'An older post.',
          createdAt: '2026-07-01T09:00:00.000Z',
        },
        indexedAt: '2026-07-01T09:00:01.000Z',
      },
    },
  ],
  cursor: 'some-cursor',
};

describe('parseBlueskyFeed', () => {
  it('extracts every post from a well-formed feed response', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    expect(posts).toHaveLength(2);
  });

  it('extracts uri, text, and createdAt for each post', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    const newest = posts.find(p => p.uri === 'at://did:plc:abc123/app.bsky.feed.post/newest1')!;
    expect(newest.text).toBe('Newest post about the campaign launch.');
    expect(newest.createdAt.toISOString()).toBe('2026-07-02T11:03:00.000Z');
  });

  it('builds a bsky.app web URL from the post URI using the handle, not the DID', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    const newest = posts.find(p => p.uri === 'at://did:plc:abc123/app.bsky.feed.post/newest1')!;
    expect(newest.postUrl).toBe('https://bsky.app/profile/fusionparty.bsky.social/post/newest1');
  });

  it('sets authorHandle to the handle passed in', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    expect(posts.every(p => p.authorHandle === HANDLE)).toBe(true);
  });

  it('returns an empty array for a feed with no entries', () => {
    expect(parseBlueskyFeed({ feed: [] }, HANDLE)).toEqual([]);
  });

  it('returns an empty array for malformed/missing feed data rather than throwing', () => {
    expect(() => parseBlueskyFeed({}, HANDLE)).not.toThrow();
    expect(parseBlueskyFeed({}, HANDLE)).toEqual([]);
    expect(parseBlueskyFeed(null, HANDLE)).toEqual([]);
    expect(parseBlueskyFeed(undefined, HANDLE)).toEqual([]);
  });

  it('skips an entry missing required fields rather than throwing', () => {
    const broken = { feed: [{ post: { uri: 'at://did:plc:abc123/app.bsky.feed.post/x', cid: 'c', author: { did: 'd', handle: HANDLE } } }] };
    expect(() => parseBlueskyFeed(broken, HANDLE)).not.toThrow();
    expect(parseBlueskyFeed(broken, HANDLE)).toEqual([]);
  });

  it('skips a reply/repost entry that has no post.record.text of its own gracefully (defensive)', () => {
    const withReasonEntry = {
      feed: [
        { post: SAMPLE_FEED.feed[0].post, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
      ],
    };
    // Reposts still have a valid post payload, so they should still parse — this just
    // guards that the extra `reason` field doesn't break parsing.
    expect(parseBlueskyFeed(withReasonEntry, HANDLE)).toHaveLength(1);
  });
});

describe('findNewPosts', () => {
  it('returns posts not present in the relayed set', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    expect(findNewPosts(posts, new Set())).toHaveLength(2);
  });

  it('excludes posts already in the relayed set', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    const result = findNewPosts(posts, new Set(['at://did:plc:abc123/app.bsky.feed.post/older1']));
    expect(result.map(p => p.uri)).toEqual(['at://did:plc:abc123/app.bsky.feed.post/newest1']);
  });

  it('returns an empty array when every post has already been relayed', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    const relayed = new Set(posts.map(p => p.uri));
    expect(findNewPosts(posts, relayed)).toEqual([]);
  });

  it('sorts new posts oldest-first, so they relay in post order', () => {
    const posts = parseBlueskyFeed(SAMPLE_FEED, HANDLE);
    const result = findNewPosts(posts, new Set());
    expect(result.map(p => p.uri)).toEqual([
      'at://did:plc:abc123/app.bsky.feed.post/older1',
      'at://did:plc:abc123/app.bsky.feed.post/newest1',
    ]);
  });

  it('returns an empty array for an empty posts list', () => {
    expect(findNewPosts([], new Set())).toEqual([]);
  });
});
