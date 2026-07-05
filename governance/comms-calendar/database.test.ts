import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CommsCalendarDatabaseManager } from './database';

let db: CommsCalendarDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new CommsCalendarDatabaseManager(sqlite);
});

describe('getConfigValue / setConfigValue', () => {
  it('returns null for an unknown key', () => {
    expect(db.getConfigValue('message_id')).toBeNull();
  });

  it('round-trips a value', () => {
    db.setConfigValue('message_id', 'msg-123');
    expect(db.getConfigValue('message_id')).toBe('msg-123');
  });

  it('overwrites an existing value', () => {
    db.setConfigValue('message_id', 'msg-123');
    db.setConfigValue('message_id', 'msg-456');
    expect(db.getConfigValue('message_id')).toBe('msg-456');
  });

  it('keeps different keys independent', () => {
    db.setConfigValue('message_id', 'msg-123');
    db.setConfigValue('channel_id', 'ch-999');
    expect(db.getConfigValue('message_id')).toBe('msg-123');
    expect(db.getConfigValue('channel_id')).toBe('ch-999');
  });
});
