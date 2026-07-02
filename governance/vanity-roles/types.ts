/**
 * Vanity Roles module type definitions.
 * Replaces Fusion Brain's (YAGPDB) reaction-role granting in #tag-yourself. Decision-only —
 * delegates the actual grant/exclusivity logic to governance/role-police for grouped roles.
 */

/**
 * Maps a #tag-yourself reaction emoji to the role it grants.
 * 'grouped' roles (state/movement) defer to role-police's exclusivity engine on grant, and
 * are not auto-revoked on unreact. 'opt-in' roles are granted/revoked directly, 1:1 with
 * the reaction, no exclusivity applied.
 */
export interface VanityRoleMapping {
  emoji: string;
  roleName: string;
  kind: 'grouped' | 'opt-in';
}

/** Decision returned by resolveVanityReaction — what interaction.ts should do, if anything. */
export type VanityReactionAction =
  | { action: 'grant-grouped'; roleName: string }
  | { action: 'grant-opt-in'; roleName: string }
  | { action: 'revoke-opt-in'; roleName: string }
  | { action: 'noop' };
