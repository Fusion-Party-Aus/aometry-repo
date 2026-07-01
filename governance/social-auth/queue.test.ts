import { describe, it, expect } from 'vitest';
import { formatQueueEntry, groupSubmissionsByStatus } from './queue';
import { AuthPostStatus, Sensitivity, SocialAuthSubmission, GantryState } from './types';

function makeSubmission(overrides: Partial<SocialAuthSubmission> = {}): SocialAuthSubmission {
  const base: SocialAuthSubmission = {
    id: 'AUTH-2026-001',
    submitterId: 'u1',
    submitterName: 'Alice',
    destinations: ['Twitter/X'],
    content: { commentary: 'Test', articleLink: null, policyLinks: [], hashtags: [] },
    sensitivity: Sensitivity.LOW,
    selfApprove: false,
    approverPool: { name: 'authnational', memberIds: ['u2', 'u3'] },
    initialTimerMinutes: 240,
    requiredApprovals: 1,
    status: AuthPostStatus.PENDING,
    submittedAt: new Date('2026-01-01T10:00:00Z'),
    expiresAt: new Date('2026-01-01T14:00:00Z'),
    resolvedAt: null,
    publishedAt: null,
    approveVotes: [],
    objectVotes: [],
    edits: [],
    timerCalculation: {
      initialTimerMinutes: 240,
      approvalRate: 0,
      objectionRate: 0,
      timerModifier: 1,
      currentTimerMinutes: 240,
      floor: 120,
      ceiling: 480,
      clampedTimerMinutes: 240,
      gantryState: GantryState.NONE,
      gantryExpiresAt: null,
    },
    channelId: 'ch1',
    messageId: 'msg1',
  };
  return { ...base, ...overrides };
}

describe('formatQueueEntry', () => {
  it('includes the submission id', () => {
    const entry = formatQueueEntry(makeSubmission());
    expect(entry).toContain('AUTH-2026-001');
  });

  it('includes submitter mention', () => {
    const entry = formatQueueEntry(makeSubmission({ submitterId: 'u42' }));
    expect(entry).toContain('<@u42>');
  });

  it('includes approval count and required', () => {
    const sub = makeSubmission({ requiredApprovals: 2 });
    const entry = formatQueueEntry(sub);
    expect(entry).toContain('0/2');
  });

  it('includes non-zero objection count', () => {
    const sub = makeSubmission({
      objectVotes: [{ id: 1, postId: 'AUTH-2026-001', userId: 'u2', userName: 'Bob', voteType: 'object' as any, timestamp: new Date() }],
    });
    const entry = formatQueueEntry(sub);
    expect(entry).toContain('❌');
  });

  it('includes sensitivity', () => {
    const entry = formatQueueEntry(makeSubmission({ sensitivity: Sensitivity.HIGH }));
    expect(entry).toContain('high');
  });

  it('includes destinations', () => {
    const entry = formatQueueEntry(makeSubmission({ destinations: ['Facebook', 'Twitter/X'] }));
    expect(entry).toContain('Facebook');
  });
});

describe('groupSubmissionsByStatus', () => {
  it('groups by status correctly', () => {
    const pending = makeSubmission({ id: 'AUTH-2026-001', status: AuthPostStatus.PENDING });
    const approved = makeSubmission({ id: 'AUTH-2026-002', status: AuthPostStatus.APPROVED });
    const failed = makeSubmission({ id: 'AUTH-2026-003', status: AuthPostStatus.PUBLISH_FAILED });

    const groups = groupSubmissionsByStatus([pending, approved, failed]);
    expect(groups[AuthPostStatus.PENDING]).toHaveLength(1);
    expect(groups[AuthPostStatus.APPROVED]).toHaveLength(1);
    expect(groups[AuthPostStatus.PUBLISH_FAILED]).toHaveLength(1);
  });

  it('returns empty arrays for missing statuses', () => {
    const groups = groupSubmissionsByStatus([]);
    expect(groups[AuthPostStatus.PENDING]).toHaveLength(0);
    expect(groups[AuthPostStatus.APPROVED]).toHaveLength(0);
    expect(groups[AuthPostStatus.IN_EDIT]).toHaveLength(0);
    expect(groups[AuthPostStatus.PUBLISH_FAILED]).toHaveLength(0);
  });

  it('sorts each group by submittedAt ascending (oldest first)', () => {
    const newer = makeSubmission({ id: 'AUTH-2026-002', submittedAt: new Date('2026-01-02T10:00:00Z') });
    const older = makeSubmission({ id: 'AUTH-2026-001', submittedAt: new Date('2026-01-01T10:00:00Z') });
    const groups = groupSubmissionsByStatus([newer, older]);
    expect(groups[AuthPostStatus.PENDING][0].id).toBe('AUTH-2026-001');
  });
});
