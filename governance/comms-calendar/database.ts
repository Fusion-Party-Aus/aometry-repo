/**
 * Comms Calendar Database Manager — key-value config storage only (standing message ID,
 * target channel ID), so the module can find and refresh the same #comms-cal embed across
 * restarts instead of posting a new one each time. Same minimal pattern as social-auth's
 * bot_config table.
 */

import Database from 'better-sqlite3';

export class CommsCalendarDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    CommsCalendarDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (CommsCalendarDatabaseManager.instance) {
      this.db = CommsCalendarDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comms_calendar_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getConfigValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM comms_calendar_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfigValue(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO comms_calendar_config (key, value) VALUES (?, ?)').run(key, value);
  }
}
