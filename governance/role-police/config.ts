/**
 * Role Police live configuration — the maintainability lever for this module.
 * Editing exclusivity groups (adding/removing a state or movement role) is a one-line
 * change here, no logic touched, no redeploy of calculator.ts required.
 *
 * Role names, not Discord snowflake IDs — resolved to real Role objects at runtime by
 * interaction.ts, same convention as ChannelUtils.ts. Snowflake IDs are per-guild and
 * must never be committed.
 *
 * VERIFICATION and the two grant triggers are documented explicitly in the Operations
 * Manual. STATE_GROUP and MOVEMENT_GROUP's memberRoleNames are TODO — the manual
 * describes the mechanism but does not enumerate the actual state/movement role names
 * used on the live server. Fill these in from the real #tag-yourself role list before
 * wiring this module up to a guild.
 */

import { RoleGroup, OnGrantTrigger } from './types';

/** No placeholder — every user holds exactly one of these three by definition. */
export const VERIFICATION_GROUP: RoleGroup = {
  id: 'verification',
  memberRoleNames: ['unverified', 'Friend', 'Member'],
};

/** TODO: populate with the real state role names from #tag-yourself. */
export const STATE_GROUP: RoleGroup = {
  id: 'state',
  memberRoleNames: [],
  placeholderRoleName: 'no state',
};

/** TODO: populate with the real movement role names from #tag-yourself. */
export const MOVEMENT_GROUP: RoleGroup = {
  id: 'movement',
  memberRoleNames: [],
  placeholderRoleName: 'no movement',
};

/** All configured exclusivity groups, passed to resolveFullRoleChange by interaction.ts. */
export const ROLE_GROUPS: RoleGroup[] = [VERIFICATION_GROUP, STATE_GROUP, MOVEMENT_GROUP];

/** Cross-group side effects fired on grant, per the Operations Manual's role-setting rules. */
export const GRANT_TRIGGERS: OnGrantTrigger[] = [
  // "A user receiving the @unverified role is also automatically assigned @no state."
  { whenRoleName: 'unverified', alsoGrantRoleName: 'no state' },
  // "A user receiving the @Member role is also automatically assigned @no movement."
  { whenRoleName: 'Member', alsoGrantRoleName: 'no movement' },
];

/** Opt-out role: applied by the "?rejectstates" custom command (currently on Dyno). */
export const OPT_OUT_STATES_ROLE = 'opt-out-states';
