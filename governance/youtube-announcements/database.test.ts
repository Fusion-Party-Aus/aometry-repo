import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { YoutubeAnnouncementsDatabaseManager } from './database';

let db: YoutubeAnnouncementsDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new YoutubeAnnouncementsDatabaseManager(sqlite);
});

describe('markAnnounced / getAnnouncedVideoIds', () => {
  it('returns an empty set when nothing has been announced', () => {
    expect(db.getAnnouncedVideoIds()).toEqual(new Set());
  });

  it('includes a video after it is marked announced', () => {
    db.markAnnounced('AAA111');
    expect(db.getAnnouncedVideoIds().has('AAA111')).toBe(true);
  });

  it('tracks multiple announced videos independently', () => {
    db.markAnnounced('AAA111');
    db.markAnnounced('BBB222');
    const ids = db.getAnnouncedVideoIds();
    expect(ids.has('AAA111')).toBe(true);
    expect(ids.has('BBB222')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('marking the same video twice does not throw or duplicate', () => {
    db.markAnnounced('AAA111');
    expect(() => db.markAnnounced('AAA111')).not.toThrow();
    expect(db.getAnnouncedVideoIds().size).toBe(1);
  });
});
