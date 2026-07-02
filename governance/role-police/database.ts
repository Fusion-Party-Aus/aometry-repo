/**
 * Role Police Database Manager — audit trail only (v1 scope). Role state itself lives in
 * Discord; this module never needs to be the source of truth for who has what role, only
 * a record of what the bot did and what it observed happening outside its control.
 */

import Database from 'better-sqlite3';
import { RolePoliceAuditLog } from './types';

/** Audit-log persistence for role-police. See module docblock above for scope. */
export class RolePoliceDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    RolePoliceDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (RolePoliceDatabaseManager.instance) {
      this.db = RolePoliceDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS role_police_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        roles_added TEXT NOT NULL,
        roles_removed TEXT NOT NULL,
        group_id TEXT,
        timestamp INTEGER NOT NULL,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_role_police_audit_user_id ON role_police_audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_role_police_audit_event_type ON role_police_audit_log(event_type);
    `);
  }

  addAuditLog(log: Omit<RolePoliceAuditLog, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO role_police_audit_log (
        user_id, event_type, roles_added, roles_removed, group_id, timestamp, details
      ) VALUES (
        @user_id, @event_type, @roles_added, @roles_removed, @group_id, @timestamp, @details
      )
    `);

    stmt.run({
      user_id: log.userId,
      event_type: log.eventType,
      roles_added: JSON.stringify(log.rolesAdded),
      roles_removed: JSON.stringify(log.rolesRemoved),
      group_id: log.groupId ?? null,
      timestamp: log.timestamp.getTime(),
      details: log.details ? JSON.stringify(log.details) : null,
    });
  }

  getAuditLog(userId: string): RolePoliceAuditLog[] {
    const stmt = this.db.prepare(
      'SELECT * FROM role_police_audit_log WHERE user_id = ? ORDER BY timestamp ASC'
    );
    return (stmt.all(userId) as any[]).map(row => this.rowToLog(row));
  }

  /** Most recent manual (non-bot) role changes across all users, for an ops-visibility view. */
  getRecentManualChanges(limit: number): RolePoliceAuditLog[] {
    const stmt = this.db.prepare(
      `SELECT * FROM role_police_audit_log WHERE event_type = 'manual_change' ORDER BY timestamp DESC LIMIT ?`
    );
    return (stmt.all(limit) as any[]).map(row => this.rowToLog(row));
  }

  private rowToLog(row: any): RolePoliceAuditLog {
    return {
      id: row.id,
      userId: row.user_id,
      eventType: row.event_type,
      rolesAdded: JSON.parse(row.roles_added),
      rolesRemoved: JSON.parse(row.roles_removed),
      groupId: row.group_id ?? undefined,
      timestamp: new Date(row.timestamp),
      details: row.details ? JSON.parse(row.details) : undefined,
    };
  }
}
