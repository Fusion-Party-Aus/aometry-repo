/**
 * Role Police calculation engine — pure functions, no Discord.js.
 * Mirrors governance/social-auth's calculator.ts pattern: all rule logic lives here,
 * fully unit-tested; interaction.ts is thin glue that calls into this and applies the result.
 */

import { RoleGroup, OnGrantTrigger, RoleChangeResult, RoleDiffClassification } from './types';

/**
 * Resolve the effect of granting a single role. Two cases:
 *  - Granting a member role removes any other member role the user holds in the same
 *    exclusivity group, plus that group's placeholder if held.
 *  - Granting a placeholder role directly (only reachable via a trigger — see
 *    resolveGrantTriggers) adds it unless the user already holds a real member role in
 *    that group, in which case the grant is a no-op rather than overriding their choice.
 * Roles that belong to no configured group (e.g. opt-in roles) are a no-op — exclusivity
 * does not apply to them.
 */
export function resolveGroupChange(
  currentRoleNames: ReadonlySet<string>,
  grantedRoleName: string,
  groups: RoleGroup[]
): RoleChangeResult {
  const memberGroup = groups.find(g => g.memberRoleNames.includes(grantedRoleName));
  if (memberGroup) {
    const toRemove: string[] = [];
    for (const roleName of memberGroup.memberRoleNames) {
      if (roleName !== grantedRoleName && currentRoleNames.has(roleName)) {
        toRemove.push(roleName);
      }
    }
    if (memberGroup.placeholderRoleName && currentRoleNames.has(memberGroup.placeholderRoleName)) {
      toRemove.push(memberGroup.placeholderRoleName);
    }
    return { toAdd: [grantedRoleName], toRemove };
  }

  const placeholderGroup = groups.find(g => g.placeholderRoleName === grantedRoleName);
  if (placeholderGroup) {
    const hasRealMember = placeholderGroup.memberRoleNames.some(r => currentRoleNames.has(r));
    if (hasRealMember || currentRoleNames.has(grantedRoleName)) {
      return { toAdd: [], toRemove: [] };
    }
    return { toAdd: [grantedRoleName], toRemove: [] };
  }

  return { toAdd: [], toRemove: [] };
}

/**
 * Cross-group side-effect grants triggered by granting a given role
 * (e.g. granting "unverified" also grants "no-state").
 */
export function resolveGrantTriggers(grantedRoleName: string, triggers: OnGrantTrigger[]): string[] {
  return triggers.filter(t => t.whenRoleName === grantedRoleName).map(t => t.alsoGrantRoleName);
}

/**
 * Full resolution for a single incoming role grant: applies exclusivity for the granted
 * role's own group, then chains through any triggered grants (each resolved against the
 * same exclusivity engine, seeing the effects of earlier steps in the chain), and dedupes
 * any role that ends up added-then-removed (or vice versa) within the same chain.
 */
export function resolveFullRoleChange(
  currentRoleNames: ReadonlySet<string>,
  grantedRoleName: string,
  groups: RoleGroup[],
  triggers: OnGrantTrigger[] = []
): RoleChangeResult {
  const toAdd = new Set<string>();
  const toRemove = new Set<string>();
  const simulatedRoles = new Set(currentRoleNames);

  const queue = [grantedRoleName, ...resolveGrantTriggers(grantedRoleName, triggers)];
  for (const roleName of queue) {
    const change = resolveGroupChange(simulatedRoles, roleName, groups);
    change.toAdd.forEach(r => { toAdd.add(r); toRemove.delete(r); simulatedRoles.add(r); });
    change.toRemove.forEach(r => { toRemove.add(r); toAdd.delete(r); simulatedRoles.delete(r); });
  }

  return { toAdd: [...toAdd], toRemove: [...toRemove] };
}

/**
 * Compare an observed before/after role diff against what the bot expected to apply.
 * Used to distinguish bot-applied changes from manual admin edits for audit logging —
 * manual changes are logged for visibility only, never auto-corrected (v1 scope).
 */
export function classifyRoleDiff(
  previousRoleNames: ReadonlySet<string>,
  currentRoleNames: ReadonlySet<string>,
  expectedChange: RoleChangeResult
): RoleDiffClassification {
  const actualAdded = [...currentRoleNames].filter(r => !previousRoleNames.has(r));
  const actualRemoved = [...previousRoleNames].filter(r => !currentRoleNames.has(r));

  if (actualAdded.length === 0 && actualRemoved.length === 0) return 'no-change';

  const addedSet = new Set(actualAdded);
  const removedSet = new Set(actualRemoved);
  const expectedAddedSet = new Set(expectedChange.toAdd);
  const expectedRemovedSet = new Set(expectedChange.toRemove);

  const addedMatches = addedSet.size === expectedAddedSet.size &&
    [...addedSet].every(r => expectedAddedSet.has(r));
  const removedMatches = removedSet.size === expectedRemovedSet.size &&
    [...removedSet].every(r => expectedRemovedSet.has(r));

  return addedMatches && removedMatches ? 'bot-applied' : 'manual';
}
