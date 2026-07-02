/**
 * Role Police module type definitions.
 * Replaces Gamer bot's role-management functions: mutual-exclusion groups,
 * placeholder-role backfill, and cross-group grant triggers.
 *
 * Uses role NAMES (not Discord snowflake IDs), same convention as ChannelUtils.ts —
 * role IDs are per-guild and resolved at runtime by interaction.ts, never committed.
 */

/**
 * A set of mutually-exclusive roles. Granting one member role removes any other
 * member role of the same group the user holds, plus the group's placeholder (if any).
 * placeholderRoleName is omitted for groups where every user always holds exactly one
 * member role by definition (e.g. verification: unverified/Friend/Member).
 */
export interface RoleGroup {
  id: string;
  memberRoleNames: string[];
  placeholderRoleName?: string;
}

/**
 * Cross-group side effect: granting `whenRoleName` also grants `alsoGrantRoleName`.
 * e.g. granting "unverified" also grants "no-state" (a different group's placeholder).
 */
export interface OnGrantTrigger {
  whenRoleName: string;
  alsoGrantRoleName: string;
}

/** Role names to add/remove to apply a resolved change; returned by resolveGroupChange and resolveFullRoleChange. */
export interface RoleChangeResult {
  toAdd: string[];
  toRemove: string[];
}

/** Result of classifyRoleDiff: whether an observed role diff matches a pending bot-applied change. */
export type RoleDiffClassification = 'bot-applied' | 'manual' | 'no-change';

/**
 * Audit trail entry. Bot-applied changes are logged for record-keeping; manual changes
 * (an admin editing roles directly in Discord) are logged for visibility but never
 * auto-corrected — v1 scope is grant-triggered enforcement only.
 */
export interface RolePoliceAuditLog {
  id: number;
  userId: string;
  eventType: 'bot_grant' | 'manual_change';
  rolesAdded: string[];
  rolesRemoved: string[];
  groupId?: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}
