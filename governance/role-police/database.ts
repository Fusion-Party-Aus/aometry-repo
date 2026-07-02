/**
 * Role Police Database Manager — audit trail only. See types.ts's module docblock for why
 * this module doesn't do role enforcement (the Aometry host handles that natively).
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
        role_name TEXT NOT NULL,
        action TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_role_police_audit_user_id ON role_police_audit_log(user_id);
    `);
  }

  addAuditLog(log: Omit<RolePoliceAuditLog, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO role_police_audit_log (user_id, role_name, action, source, timestamp, details)
      VALUES (@user_id, @role_name, @action, @source, @timestamp, @details)
    `);

    stmt.run({
      user_id: log.userId,
      role_name: log.roleName,
      action: log.action,
      source: log.source,
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

  /** Most recent grants/revokes across all users, for an ops-visibility view. */
  getRecentGrants(limit: number): RolePoliceAuditLog[] {
    const stmt = this.db.prepare(
      'SELECT * FROM role_police_audit_log ORDER BY timestamp DESC LIMIT ?'
    );
    return (stmt.all(limit) as any[]).map(row => this.rowToLog(row));
  }

  private rowToLog(row: any): RolePoliceAuditLog {
    return {
      id: row.id,
      userId: row.user_id,
      roleName: row.role_name,
      action: row.action,
      source: row.source,
      timestamp: new Date(row.timestamp),
      details: row.details ? JSON.parse(row.details) : undefined,
    };
  }
}
