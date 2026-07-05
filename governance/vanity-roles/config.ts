/**
 * Vanity Roles live configuration — emoji→role mappings for the #tag-yourself channel.
 * TODO: populate with the real emoji identifiers and role names from the live
 * #tag-yourself messages. The Operations Manual documents three mapping groups
 * (state, movement, opt-in) but does not enumerate them.
 */

import { VanityRoleMapping } from './types';

export const VANITY_ROLE_MAPPINGS: VanityRoleMapping[] = [
  // { emoji: '...', roleName: '...', kind: 'grouped' },   // state roles
  // { emoji: '...', roleName: '...', kind: 'grouped' },   // movement roles (member only)
  // { emoji: '...', roleName: '...', kind: 'opt-in' },    // opt-in roles
];
