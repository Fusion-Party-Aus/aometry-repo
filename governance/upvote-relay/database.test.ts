import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { UpvoteRelayDatabaseManager } from './database';

let db: UpvoteRelayDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new UpvoteRelayDatabaseManager(sqlite);
});

describe('markRelayed / getRelayedUris', () => {
  it('returns an empty set when nothing has been relayed', () => {
    expect(db.getRelayedUris()).toEqual(new Set());
  });

  it('includes a post uri after it is marked relayed', () => {
    db.markRelayed('at://did:plc:abc/app.bsky.feed.post/1');
    expect(db.getRelayedUris().has('at://did:plc:abc/app.bsky.feed.post/1')).toBe(true);
  });

  it('tracks multiple relayed posts independently', () => {
    db.markRelayed('at://a');
    db.markRelayed('at://b');
    const uris = db.getRelayedUris();
    expect(uris.has('at://a')).toBe(true);
    expect(uris.has('at://b')).toBe(true);
    expect(uris.size).toBe(2);
  });

  it('marking the same uri twice does not throw or duplicate', () => {
    db.markRelayed('at://a');
    expect(() => db.markRelayed('at://a')).not.toThrow();
    expect(db.getRelayedUris().size).toBe(1);
  });
});
