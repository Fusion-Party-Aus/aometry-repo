import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { formatQueueEntry, groupSubmissionsByStatus, buildQueueEmbed } from './queue';
import { SocialAuthDatabaseManager } from './database';
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

let db: SocialAuthDatabaseManager;
beforeEach(() => {
  const raw = new Database(':memory:');
  SocialAuthDatabaseManager.setGlobalDatabase(raw);
  db = new SocialAuthDatabaseManager(raw);
});

describe('buildQueueEmbed', () => {
  it('returns an object with a data property (EmbedBuilder shape)', () => {
    const embed = buildQueueEmbed([]);
    expect(embed).toHaveProperty('data');
  });

  it('empty queue embed has a clear-queue description', () => {
    const embed = buildQueueEmbed([]);
    expect(JSON.stringify(embed.data)).toContain('clear');
  });

  it('non-empty queue embed mentions submission id', () => {
    const embed = buildQueueEmbed([makeSubmission()]);
    expect(JSON.stringify(embed.data)).toContain('AUTH-2026-001');
  });

  it('never emits a field value longer than the Discord 1024-char limit', () => {
    // 60 pending entries far exceed a single 1024-char field.
    const many = Array.from({ length: 60 }, (_, i) =>
      makeSubmission({ id: `AUTH-2026-${String(i + 1).padStart(3, '0')}` })
    );
    const embed = buildQueueEmbed(many);
    for (const field of embed.data.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('does not silently drop entries mid-list — accounts for every submission', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeSubmission({ id: `AUTH-2026-${String(i + 1).padStart(3, '0')}` })
    );
    const embed = buildQueueEmbed(many);
    const rendered = JSON.stringify(embed.data);
    // Either every id is shown across the split fields, or an explicit overflow marker
    // reports how many were omitted — never a blind mid-entry truncation.
    const shownCount = many.filter(s => rendered.includes(s.id)).length;
    const hasOverflowMarker = /\+\d+ more/.test(rendered);
    expect(shownCount === many.length || hasOverflowMarker).toBe(true);
  });

  it('exercises the >25-field overflow branch: shown + reported-omitted exactly equals total', () => {
    // Force well past Discord's 25-field cap and past the 1024-char chunk size, so the
    // section-splitting logic must produce more than 25 continuation fields.
    const many = Array.from({ length: 1000 }, (_, i) =>
      makeSubmission({ id: `AUTH-2026-${String(i + 1).padStart(4, '0')}` })
    );
    const embed = buildQueueEmbed(many);
    const fields = embed.data.fields ?? [];

    expect(fields.length).toBeLessThanOrEqual(25);

    const overflowField = fields.find(f => /\+\d+ more not shown/.test(f.value));
    expect(overflowField).toBeDefined();
    const omittedCount = parseInt(overflowField!.value.match(/\+(\d+) more not shown/)![1], 10);

    const rendered = JSON.stringify(fields);
    const shownCount = many.filter(s => rendered.includes(s.id)).length;

    expect(shownCount + omittedCount).toBe(many.length);
  });
});

describe('bot_config DB methods', () => {
  it('getConfigValue returns null for unknown key', () => {
    expect(db.getConfigValue('queue_message_id')).toBeNull();
  });

  it('setConfigValue + getConfigValue round-trips', () => {
    db.setConfigValue('queue_message_id', 'msg-123');
    expect(db.getConfigValue('queue_message_id')).toBe('msg-123');
  });

  it('setConfigValue overwrites existing value', () => {
    db.setConfigValue('queue_message_id', 'msg-123');
    db.setConfigValue('queue_message_id', 'msg-456');
    expect(db.getConfigValue('queue_message_id')).toBe('msg-456');
  });

  it('different keys are independent', () => {
    db.setConfigValue('queue_message_id', 'msg-123');
    db.setConfigValue('queue_channel_id', 'ch-999');
    expect(db.getConfigValue('queue_message_id')).toBe('msg-123');
    expect(db.getConfigValue('queue_channel_id')).toBe('ch-999');
  });
});

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
