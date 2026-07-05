/**
 * Vanity Roles calculation engine — pure function, no Discord.js.
 * Decides what a #tag-yourself reaction event should do; interaction.ts applies the
 * decision (delegating to role-police for grouped roles, direct grant/revoke for opt-in).
 */

import { VanityRoleMapping, VanityReactionAction } from './types';

/**
 * Resolve a single reaction add/remove event against the configured emoji→role mappings.
 * Grouped roles only act on add (grant, deferred to role-police); opt-in roles act on both
 * add (grant) and remove (revoke). An unmapped emoji is always a no-op.
 */
export function resolveVanityReaction(
  emoji: string,
  added: boolean,
  mappings: VanityRoleMapping[]
): VanityReactionAction {
  const mapping = mappings.find(m => m.emoji === emoji);
  if (!mapping) return { action: 'noop' };

  if (mapping.kind === 'grouped') {
    return added ? { action: 'grant-grouped', roleName: mapping.roleName } : { action: 'noop' };
  }

  // opt-in
  return added
    ? { action: 'grant-opt-in', roleName: mapping.roleName }
    : { action: 'revoke-opt-in', roleName: mapping.roleName };
}
