/**
 * Upvote Relay Database Manager — tracks which Bluesky post URIs have already been
 * relayed to #upvote-this, so a bot restart never re-posts a post already relayed.
 */

import Database from 'better-sqlite3';

export class UpvoteRelayDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    UpvoteRelayDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (UpvoteRelayDatabaseManager.instance) {
      this.db = UpvoteRelayDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS upvote_relay_posts (
        uri TEXT PRIMARY KEY,
        relayed_at INTEGER NOT NULL
      );
    `);
  }

  markRelayed(uri: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO upvote_relay_posts (uri, relayed_at) VALUES (?, ?)'
    ).run(uri, Date.now());
  }

  getRelayedUris(): Set<string> {
    const rows = this.db.prepare('SELECT uri FROM upvote_relay_posts').all() as { uri: string }[];
    return new Set(rows.map(r => r.uri));
  }
}
