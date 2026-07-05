import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { RolePoliceDatabaseManager } from './database';

let db: RolePoliceDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new RolePoliceDatabaseManager(sqlite);
});

describe('addAuditLog / getAuditLog', () => {
  it('persists a grant entry and retrieves it', () => {
    db.addAuditLog({
      userId: 'u1',
      roleName: 'NSW',
      action: 'grant',
      source: 'vanity-roles',
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });
    const log = db.getAuditLog('u1');
    expect(log).toHaveLength(1);
    expect(log[0].roleName).toBe('NSW');
    expect(log[0].action).toBe('grant');
    expect(log[0].source).toBe('vanity-roles');
  });

  it('persists a revoke entry', () => {
    db.addAuditLog({
      userId: 'u2',
      roleName: 'newsletter-subscriber',
      action: 'revoke',
      source: 'vanity-roles',
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });
    const log = db.getAuditLog('u2');
    expect(log[0].action).toBe('revoke');
  });

  it('returns entries ordered oldest-first', () => {
    db.addAuditLog({ userId: 'u1', roleName: 'A', action: 'grant', source: 's', timestamp: new Date('2026-01-02T00:00:00Z') });
    db.addAuditLog({ userId: 'u1', roleName: 'B', action: 'grant', source: 's', timestamp: new Date('2026-01-01T00:00:00Z') });
    const log = db.getAuditLog('u1');
    expect(log.map(l => l.roleName)).toEqual(['B', 'A']);
  });

  it('returns an empty array for a user with no history', () => {
    expect(db.getAuditLog('nobody')).toEqual([]);
  });

  it('does not mix up entries between different users', () => {
    db.addAuditLog({ userId: 'u1', roleName: 'A', action: 'grant', source: 's', timestamp: new Date() });
    db.addAuditLog({ userId: 'u2', roleName: 'B', action: 'grant', source: 's', timestamp: new Date() });
    expect(db.getAuditLog('u1')).toHaveLength(1);
    expect(db.getAuditLog('u2')).toHaveLength(1);
  });

  it('persists arbitrary details as a JSON blob and round-trips it', () => {
    db.addAuditLog({
      userId: 'u1',
      roleName: 'A',
      action: 'grant',
      source: 's',
      timestamp: new Date(),
      details: { note: 'via reaction', emoji: 'flag_nsw' },
    });
    const log = db.getAuditLog('u1');
    expect(log[0].details).toEqual({ note: 'via reaction', emoji: 'flag_nsw' });
  });

  it('details is undefined (not an empty object) when omitted', () => {
    db.addAuditLog({ userId: 'u1', roleName: 'A', action: 'grant', source: 's', timestamp: new Date() });
    expect(db.getAuditLog('u1')[0].details).toBeUndefined();
  });
});

describe('getRecentGrants', () => {
  it('returns entries across all users, most recent first', () => {
    db.addAuditLog({ userId: 'u1', roleName: 'A', action: 'grant', source: 's', timestamp: new Date('2026-01-01T00:00:00Z') });
    db.addAuditLog({ userId: 'u2', roleName: 'B', action: 'grant', source: 's', timestamp: new Date('2026-01-02T00:00:00Z') });
    const recent = db.getRecentGrants(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].userId).toBe('u2');
    expect(recent[1].userId).toBe('u1');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      db.addAuditLog({ userId: 'u1', roleName: `R${i}`, action: 'grant', source: 's', timestamp: new Date() });
    }
    expect(db.getRecentGrants(3)).toHaveLength(3);
  });

  it('returns an empty array when nothing has been logged', () => {
    expect(db.getRecentGrants(10)).toEqual([]);
  });
});
