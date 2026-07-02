import { describe, it, expect } from 'vitest';
import { resolveVanityReaction } from './calculator';
import { VanityRoleMapping } from './types';

// Fixtures mirror the Operations Manual's "Vanity Selections" section but use readable
// test names instead of real emoji identifiers — real config lives in config.ts.
const MAPPINGS: VanityRoleMapping[] = [
  { emoji: 'flag_vic', roleName: 'Victoria', kind: 'grouped' },
  { emoji: 'flag_nsw', roleName: 'NSW', kind: 'grouped' },
  { emoji: 'leaf', roleName: 'ClimateAction', kind: 'grouped' },
  { emoji: 'bell', roleName: 'newsletter-subscriber', kind: 'opt-in' },
  { emoji: 'megaphone', roleName: 'announcements-opt-in', kind: 'opt-in' },
];

describe('resolveVanityReaction', () => {
  it('adding a reaction mapped to a grouped role resolves to grant-grouped', () => {
    const result = resolveVanityReaction('flag_vic', true, MAPPINGS);
    expect(result).toEqual({ action: 'grant-grouped', roleName: 'Victoria' });
  });

  it('removing a reaction mapped to a grouped role resolves to noop', () => {
    // Manual: "Extra selections must be manually removed" — no auto-revoke on unreact
    // for state/movement roles.
    const result = resolveVanityReaction('flag_vic', false, MAPPINGS);
    expect(result).toEqual({ action: 'noop' });
  });

  it('adding a reaction mapped to an opt-in role resolves to grant-opt-in', () => {
    const result = resolveVanityReaction('bell', true, MAPPINGS);
    expect(result).toEqual({ action: 'grant-opt-in', roleName: 'newsletter-subscriber' });
  });

  it('removing a reaction mapped to an opt-in role resolves to revoke-opt-in', () => {
    // Manual: "Opt-in roles will be removed if the associated emoji is unselected."
    const result = resolveVanityReaction('bell', false, MAPPINGS);
    expect(result).toEqual({ action: 'revoke-opt-in', roleName: 'newsletter-subscriber' });
  });

  it('an unmapped emoji resolves to noop regardless of add/remove', () => {
    expect(resolveVanityReaction('unknown-emoji', true, MAPPINGS)).toEqual({ action: 'noop' });
    expect(resolveVanityReaction('unknown-emoji', false, MAPPINGS)).toEqual({ action: 'noop' });
  });

  it('an empty mapping list always resolves to noop', () => {
    expect(resolveVanityReaction('flag_vic', true, [])).toEqual({ action: 'noop' });
  });

  it('is case-sensitive on emoji identifiers (no accidental cross-matching)', () => {
    expect(resolveVanityReaction('FLAG_VIC', true, MAPPINGS)).toEqual({ action: 'noop' });
  });
});
