/**
 * YouTube Announcements Database Manager — tracks which video IDs have already been
 * posted to #Announcements, so a bot restart never re-announces a video already posted.
 */

import Database from 'better-sqlite3';

export class YoutubeAnnouncementsDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    YoutubeAnnouncementsDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (YoutubeAnnouncementsDatabaseManager.instance) {
      this.db = YoutubeAnnouncementsDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS youtube_announced_videos (
        video_id TEXT PRIMARY KEY,
        announced_at INTEGER NOT NULL
      );
    `);
  }

  markAnnounced(videoId: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO youtube_announced_videos (video_id, announced_at) VALUES (?, ?)'
    ).run(videoId, Date.now());
  }

  getAnnouncedVideoIds(): Set<string> {
    const rows = this.db.prepare('SELECT video_id FROM youtube_announced_videos').all() as { video_id: string }[];
    return new Set(rows.map(r => r.video_id));
  }
}
