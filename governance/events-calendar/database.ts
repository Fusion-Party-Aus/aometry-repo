/**
 * Events Calendar Database Manager.
 * - Known-events snapshot: the last-seen event list, used by detectEventChanges() to find
 *   created/changed events across timer ticks. Replaced wholesale on each save — this
 *   module doesn't need incremental event history, just "what did we see last time."
 * - Reminder dedup: which events have already had their 15-min-before ping sent.
 * - Config KV: standing "Upcoming Event Schedule" message ID, same pattern as
 *   comms-calendar/social-auth's bot_config.
 */

import Database from 'better-sqlite3';
import { CalendarEvent } from './types';

/** Persistence for events-calendar. See module docblock above for scope. */
export class EventsCalendarDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    EventsCalendarDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (EventsCalendarDatabaseManager.instance) {
      this.db = EventsCalendarDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events_calendar_known_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        all_day INTEGER NOT NULL,
        link TEXT,
        source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events_calendar_reminded (
        event_id TEXT PRIMARY KEY,
        reminded_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events_calendar_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getKnownEvents(): CalendarEvent[] {
    const rows = this.db.prepare('SELECT * FROM events_calendar_known_events').all() as any[];
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      location: row.location ?? null,
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : null,
      allDay: !!row.all_day,
      link: row.link ?? null,
      source: row.source,
    }));
  }

  /** Replaces the entire known-events snapshot — not a merge/upsert. */
  saveKnownEvents(events: CalendarEvent[]): void {
    const run = this.db.transaction((evts: CalendarEvent[]) => {
      this.db.exec('DELETE FROM events_calendar_known_events');
      const stmt = this.db.prepare(`
        INSERT INTO events_calendar_known_events (
          id, title, description, location, start_time, end_time, all_day, link, source
        ) VALUES (@id, @title, @description, @location, @start_time, @end_time, @all_day, @link, @source)
      `);
      for (const e of evts) {
        stmt.run({
          id: e.id,
          title: e.title,
          description: e.description ?? null,
          location: e.location ?? null,
          start_time: e.startTime.getTime(),
          end_time: e.endTime?.getTime() ?? null,
          all_day: e.allDay ? 1 : 0,
          link: e.link ?? null,
          source: e.source,
        });
      }
    });
    run(events);
  }

  hasBeenReminded(eventId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM events_calendar_reminded WHERE event_id = ?').get(eventId);
    return !!row;
  }

  markReminded(eventId: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO events_calendar_reminded (event_id, reminded_at) VALUES (?, ?)'
    ).run(eventId, Date.now());
  }

  getConfigValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM events_calendar_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfigValue(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO events_calendar_config (key, value) VALUES (?, ?)').run(key, value);
  }
}
