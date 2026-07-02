/**
 * Role Police module type definitions.
 *
 * Scope note: exclusivity groups, placeholder-role backfill, and cross-group grant
 * triggers ("Role Sets") are handled natively by the Aometry host itself — confirmed via
 * its `src/events/Member/guildMemberUpdate.ts`, which actively enforces UNIQUE/GROUP role
 * sets on every role change, and `src/modules/Core/moderation/roleset.ts`, the `/roleset`
 * command that manages them. This module does not reimplement that engine; it only
 * provides a shared grant/revoke + audit-log helper other plugins (vanity-roles, opt-out)
 * use for ops visibility into role changes this repo's code makes.
 */

/** A single grant or revoke this repo's code made, for ops visibility (audit trail only). */
export interface RolePoliceAuditLog {
  id: number;
  userId: string;
  roleName: string;
  action: 'grant' | 'revoke';
  source: string; // e.g. 'vanity-roles', 'role-police:opt-out', 'role-police:join'
  timestamp: Date;
  details?: Record<string, unknown>;
}
