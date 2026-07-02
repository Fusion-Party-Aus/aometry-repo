import { describe, it, expect } from 'vitest';
import { resolveGroupChange, resolveFullRoleChange, classifyRoleDiff } from './calculator';
import { RoleGroup, OnGrantTrigger } from './types';

// Fixtures mirror the Operations Manual's actual rules, but use readable test names
// instead of real Discord role IDs — real config lives in config.ts, kept separate so
// these tests never depend on production role names.
const STATE_GROUP: RoleGroup = {
  id: 'state',
  memberRoleNames: ['Victoria', 'NSW', 'Queensland'],
  placeholderRoleName: 'no-state',
};
const MOVEMENT_GROUP: RoleGroup = {
  id: 'movement',
  memberRoleNames: ['ClimateAction', 'DrugReform'],
  placeholderRoleName: 'no-movement',
};
const VERIFICATION_GROUP: RoleGroup = {
  id: 'verification',
  memberRoleNames: ['unverified', 'Friend', 'Member'],
  // No placeholder — verification group always has exactly one of these three by definition.
};
const GROUPS = [STATE_GROUP, MOVEMENT_GROUP, VERIFICATION_GROUP];

const TRIGGERS: OnGrantTrigger[] = [
  { whenRoleName: 'unverified', alsoGrantRoleName: 'no-state' },
  { whenRoleName: 'Member', alsoGrantRoleName: 'no-movement' },
];

describe('resolveGroupChange', () => {
  it('switching between two roles in the same group removes the old one', () => {
    const result = resolveGroupChange(new Set(['Member', 'Victoria']), 'NSW', GROUPS);
    expect(result.toAdd).toEqual(['NSW']);
    expect(result.toRemove).toEqual(['Victoria']);
  });

  it('granting a role in a group the user has no roles in yet only adds', () => {
    const result = resolveGroupChange(new Set(['Member']), 'Victoria', GROUPS);
    expect(result.toAdd).toEqual(['Victoria']);
    expect(result.toRemove).toEqual([]);
  });

  it('granting a role removes that group\'s placeholder if held', () => {
    const result = resolveGroupChange(new Set(['Member', 'no-state']), 'Victoria', GROUPS);
    expect(result.toAdd).toEqual(['Victoria']);
    expect(result.toRemove).toEqual(['no-state']);
  });

  it('re-granting the same role the user already has is a no-op', () => {
    const result = resolveGroupChange(new Set(['Victoria']), 'Victoria', GROUPS);
    expect(result.toAdd).toEqual(['Victoria']);
    expect(result.toRemove).toEqual([]);
  });

  it('granting a role not in any group is a no-op (e.g. opt-in roles)', () => {
    const result = resolveGroupChange(new Set(['Member']), 'newsletter-subscriber', GROUPS);
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });

  it('removes every other member role in the group, not just one, if multiple were somehow held', () => {
    // Defensive: exclusivity should hold even if the user is in an inconsistent state
    // (e.g. from a bug or manual admin action that granted two state roles).
    const result = resolveGroupChange(new Set(['Victoria', 'NSW']), 'Queensland', GROUPS);
    expect(result.toAdd).toEqual(['Queensland']);
    expect(result.toRemove).toEqual(expect.arrayContaining(['Victoria', 'NSW']));
    expect(result.toRemove).toHaveLength(2);
  });

  it('a group with no placeholder never proposes removing one', () => {
    const result = resolveGroupChange(new Set(['unverified']), 'Friend', GROUPS);
    expect(result.toAdd).toEqual(['Friend']);
    expect(result.toRemove).toEqual(['unverified']);
  });
});

describe('resolveFullRoleChange — grant triggers chained through the exclusivity engine', () => {
  it('granting "unverified" also grants "no-state" (initial role-setting)', () => {
    const result = resolveFullRoleChange(new Set(), 'unverified', GROUPS, TRIGGERS);
    expect(result.toAdd).toEqual(expect.arrayContaining(['unverified', 'no-state']));
    expect(result.toRemove).toEqual([]);
  });

  it('granting "Member" also grants "no-movement" and removes prior verification role', () => {
    const result = resolveFullRoleChange(new Set(['unverified', 'no-state']), 'Member', GROUPS, TRIGGERS);
    expect(result.toAdd).toEqual(expect.arrayContaining(['Member', 'no-movement']));
    expect(result.toRemove).toEqual(expect.arrayContaining(['unverified']));
  });

  it('a role with no trigger only produces its own group\'s change', () => {
    const result = resolveFullRoleChange(new Set(['Member']), 'Victoria', GROUPS, TRIGGERS);
    expect(result.toAdd).toEqual(['Victoria']);
    expect(result.toRemove).toEqual([]);
  });

  it('does not re-add a placeholder that gets removed later in the same chain', () => {
    // Regression guard: if a trigger granted a placeholder that a subsequent step in the
    // same chain would remove, the net result should not include it in both toAdd and toRemove.
    const result = resolveFullRoleChange(new Set(), 'unverified', GROUPS, TRIGGERS);
    const inBoth = result.toAdd.filter(r => result.toRemove.includes(r));
    expect(inBoth).toEqual([]);
  });

  it('works with no triggers configured at all', () => {
    const result = resolveFullRoleChange(new Set(['Victoria']), 'NSW', GROUPS, []);
    expect(result.toAdd).toEqual(['NSW']);
    expect(result.toRemove).toEqual(['Victoria']);
  });
});

describe('classifyRoleDiff', () => {
  const EXPECTED = { toAdd: ['NSW'], toRemove: ['Victoria'] };

  it('classifies as no-change when roles are identical', () => {
    const roles = new Set(['Member', 'Victoria']);
    expect(classifyRoleDiff(roles, roles, { toAdd: [], toRemove: [] })).toBe('no-change');
  });

  it('classifies as bot-applied when the observed diff exactly matches the expected change', () => {
    const before = new Set(['Member', 'Victoria']);
    const after = new Set(['Member', 'NSW']);
    expect(classifyRoleDiff(before, after, EXPECTED)).toBe('bot-applied');
  });

  it('classifies as manual when the diff does not match the expected change at all', () => {
    const before = new Set(['Member', 'Victoria']);
    const after = new Set(['Member']); // Victoria removed by an admin, nothing added
    expect(classifyRoleDiff(before, after, { toAdd: [], toRemove: [] })).toBe('manual');
  });

  it('classifies as manual when extra roles changed beyond what was expected', () => {
    const before = new Set(['Member', 'Victoria']);
    const after = new Set(['Member', 'NSW', 'ClimateAction']); // an unrelated role also appeared
    expect(classifyRoleDiff(before, after, EXPECTED)).toBe('manual');
  });

  it('classifies as manual when fewer roles changed than expected', () => {
    const before = new Set(['Member', 'Victoria']);
    const after = new Set(['Member']); // Victoria removed but NSW never added
    expect(classifyRoleDiff(before, after, EXPECTED)).toBe('manual');
  });
});
