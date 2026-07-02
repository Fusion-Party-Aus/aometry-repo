import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventsCalendarDatabaseManager } from './database';
import { CalendarEvent } from './types';

let db: EventsCalendarDatabaseManager;

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Branch Meeting',
    description: null,
    location: null,
    startTime: new Date('2026-06-10T10:00:00Z'),
    endTime: new Date('2026-06-10T11:00:00Z'),
    allDay: false,
    link: null,
    source: 'google',
    ...overrides,
  };
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new EventsCalendarDatabaseManager(sqlite);
});

describe('getKnownEvents / saveKnownEvents', () => {
  it('returns an empty array before any snapshot is saved', () => {
    expect(db.getKnownEvents()).toEqual([]);
  });

  it('round-trips a saved snapshot, including Date fields', () => {
    const event = makeEvent();
    db.saveKnownEvents([event]);
    const [fetched] = db.getKnownEvents();
    expect(fetched.id).toBe(event.id);
    expect(fetched.title).toBe(event.title);
    expect(fetched.startTime.toISOString()).toBe(event.startTime.toISOString());
    expect(fetched.endTime?.toISOString()).toBe(event.endTime?.toISOString());
  });

  it('replaces the previous snapshot entirely rather than merging', () => {
    db.saveKnownEvents([makeEvent({ id: 'evt-1' })]);
    db.saveKnownEvents([makeEvent({ id: 'evt-2' })]);
    const known = db.getKnownEvents();
    expect(known).toHaveLength(1);
    expect(known[0].id).toBe('evt-2');
  });

  it('round-trips a null endTime and null location/description', () => {
    db.saveKnownEvents([makeEvent({ endTime: null, location: null, description: null })]);
    const [fetched] = db.getKnownEvents();
    expect(fetched.endTime).toBeNull();
    expect(fetched.location).toBeNull();
    expect(fetched.description).toBeNull();
  });
});

describe('reminder dedup', () => {
  it('a fresh event has not been reminded', () => {
    expect(db.hasBeenReminded('evt-1')).toBe(false);
  });

  it('marking an event reminded is reflected on the next check', () => {
    db.markReminded('evt-1');
    expect(db.hasBeenReminded('evt-1')).toBe(true);
  });

  it('marking the same event reminded twice does not throw', () => {
    db.markReminded('evt-1');
    expect(() => db.markReminded('evt-1')).not.toThrow();
  });

  it('tracks different events independently', () => {
    db.markReminded('evt-1');
    expect(db.hasBeenReminded('evt-1')).toBe(true);
    expect(db.hasBeenReminded('evt-2')).toBe(false);
  });
});

describe('config value storage (standing message ID)', () => {
  it('returns null for an unknown key', () => {
    expect(db.getConfigValue('message_id')).toBeNull();
  });

  it('round-trips a value', () => {
    db.setConfigValue('message_id', 'msg-123');
    expect(db.getConfigValue('message_id')).toBe('msg-123');
  });
});
