import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RolePoliceDatabaseManager } from './database';

let db: RolePoliceDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new RolePoliceDatabaseManager(sqlite);
});

describe('addAuditLog / getAuditLog', () => {
  it('persists a bot_grant entry and retrieves it', () => {
    db.addAuditLog({
      userId: 'u1',
      eventType: 'bot_grant',
      rolesAdded: ['NSW'],
      rolesRemoved: ['Victoria'],
      groupId: 'state',
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });
    const log = db.getAuditLog('u1');
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe('bot_grant');
    expect(log[0].rolesAdded).toEqual(['NSW']);
    expect(log[0].rolesRemoved).toEqual(['Victoria']);
    expect(log[0].groupId).toBe('state');
  });

  it('persists a manual_change entry with no groupId', () => {
    db.addAuditLog({
      userId: 'u2',
      eventType: 'manual_change',
      rolesAdded: [],
      rolesRemoved: ['ClimateAction'],
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });
    const log = db.getAuditLog('u2');
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe('manual_change');
    expect(log[0].groupId).toBeUndefined();
  });

  it('returns entries ordered oldest-first', () => {
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: ['A'], rolesRemoved: [], timestamp: new Date('2026-01-02T00:00:00Z') });
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: ['B'], rolesRemoved: [], timestamp: new Date('2026-01-01T00:00:00Z') });
    const log = db.getAuditLog('u1');
    expect(log.map(l => l.rolesAdded[0])).toEqual(['B', 'A']);
  });

  it('returns an empty array for a user with no history', () => {
    expect(db.getAuditLog('nobody')).toEqual([]);
  });

  it('does not mix up entries between different users', () => {
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: ['A'], rolesRemoved: [], timestamp: new Date() });
    db.addAuditLog({ userId: 'u2', eventType: 'bot_grant', rolesAdded: ['B'], rolesRemoved: [], timestamp: new Date() });
    expect(db.getAuditLog('u1')).toHaveLength(1);
    expect(db.getAuditLog('u2')).toHaveLength(1);
  });

  it('persists arbitrary details as a JSON blob and round-trips it', () => {
    db.addAuditLog({
      userId: 'u1',
      eventType: 'manual_change',
      rolesAdded: [],
      rolesRemoved: [],
      timestamp: new Date(),
      details: { note: 'admin override', actorId: 'mod1' },
    });
    const log = db.getAuditLog('u1');
    expect(log[0].details).toEqual({ note: 'admin override', actorId: 'mod1' });
  });

  it('rolesAdded/rolesRemoved default to empty arrays when omitted from storage edge cases', () => {
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: [], rolesRemoved: [], timestamp: new Date() });
    const log = db.getAuditLog('u1');
    expect(log[0].rolesAdded).toEqual([]);
    expect(log[0].rolesRemoved).toEqual([]);
  });
});

describe('getRecentManualChanges', () => {
  it('returns only manual_change entries across all users, most recent first', () => {
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: ['A'], rolesRemoved: [], timestamp: new Date('2026-01-01T00:00:00Z') });
    db.addAuditLog({ userId: 'u1', eventType: 'manual_change', rolesAdded: [], rolesRemoved: ['B'], timestamp: new Date('2026-01-02T00:00:00Z') });
    db.addAuditLog({ userId: 'u2', eventType: 'manual_change', rolesAdded: ['C'], rolesRemoved: [], timestamp: new Date('2026-01-03T00:00:00Z') });

    const recent = db.getRecentManualChanges(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].userId).toBe('u2');
    expect(recent[1].userId).toBe('u1');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      db.addAuditLog({ userId: 'u1', eventType: 'manual_change', rolesAdded: [], rolesRemoved: [`R${i}`], timestamp: new Date() });
    }
    expect(db.getRecentManualChanges(3)).toHaveLength(3);
  });

  it('returns an empty array when there are no manual changes', () => {
    db.addAuditLog({ userId: 'u1', eventType: 'bot_grant', rolesAdded: ['A'], rolesRemoved: [], timestamp: new Date() });
    expect(db.getRecentManualChanges(10)).toEqual([]);
  });
});
