import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseScheduleFromText, nextWeekdayAt9amAest, buildFedicaPayload } from './publish';
import { SocialAuthSubmission, AuthPostStatus, GantryState, VoteType, Sensitivity } from './types';

const FIXED_NOW = new Date('2026-07-01T12:00:00Z'); // Wednesday 2026-07-01 12:00 UTC = 22:00 AEST

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseScheduleFromText', () => {
  it('parses ISO-style "schedule: YYYY-MM-DDTHH:MM" as AEST', () => {
    const d = parseScheduleFromText('Approved. schedule: 2026-07-03T09:00');
    expect(d).not.toBeNull();
    // 2026-07-03T09:00+10:00 = 2026-07-02T23:00Z
    expect(d?.toISOString()).toBe('2026-07-02T23:00:00.000Z');
  });

  it('parses space-style "schedule: YYYY-MM-DD HH:MM" as AEST', () => {
    const d = parseScheduleFromText('schedule: 2026-07-03 09:00');
    expect(d?.toISOString()).toBe('2026-07-02T23:00:00.000Z');
  });

  it('is case-insensitive', () => {
    const d = parseScheduleFromText('SCHEDULE: 2026-07-03T09:00');
    expect(d).not.toBeNull();
  });

  it('returns null for past dates', () => {
    // FIXED_NOW = 2026-07-01T12:00Z; 2026-06-30T09:00 AEST = 2026-06-29T23:00Z → past
    const d = parseScheduleFromText('schedule: 2026-06-30T09:00');
    expect(d).toBeNull();
  });

  it('returns null when no schedule tag', () => {
    expect(parseScheduleFromText('No schedule tag here')).toBeNull();
    expect(parseScheduleFromText('')).toBeNull();
  });

  it('returns null for malformed datetime', () => {
    expect(parseScheduleFromText('schedule: not-a-date')).toBeNull();
  });
});

describe('nextWeekdayAt9amAest', () => {
  it('returns a future date', () => {
    const d = nextWeekdayAt9amAest();
    expect(d.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('falls on a weekday (Mon–Fri)', () => {
    const d = nextWeekdayAt9amAest();
    const day = d.getUTCDay();
    // After converting back from AEST the UTC day may differ; check day of week in AEST
    const aestHour = ((d.getUTCHours() + 10) % 24);
    expect(aestHour).toBe(9);
    // Day in AEST coordinates
    const aestDate = new Date(d.getTime() + 10 * 3600 * 1000);
    const aestDay = aestDate.getUTCDay();
    expect(aestDay).not.toBe(0); // not Sunday
    expect(aestDay).not.toBe(6); // not Saturday
  });

  it('is 09:00 AEST (23:00 UTC previous day)', () => {
    // FIXED_NOW = Wed 2026-07-01 12:00 UTC = Wed 22:00 AEST
    // Next weekday 9am AEST = Thu 2026-07-02 09:00 AEST = 2026-07-01T23:00:00Z
    const d = nextWeekdayAt9amAest();
    expect(d.toISOString()).toBe('2026-07-01T23:00:00.000Z');
  });

  it('skips weekend days', () => {
    // Set to Friday 23:30 AEST (13:30 UTC) — next weekday 9am AEST is Monday
    vi.setSystemTime(new Date('2026-07-03T13:30:00Z')); // Fri 23:30 AEST
    const d = nextWeekdayAt9amAest();
    const aestDate = new Date(d.getTime() + 10 * 3600 * 1000);
    expect(aestDate.getUTCDay()).toBe(1); // Monday
  });
});

describe('buildFedicaPayload', () => {
  function makeSubmission(overrides: Partial<SocialAuthSubmission> = {}): SocialAuthSubmission {
    return {
      id: 'AUTH-2026-001',
      submitterId: 'u1',
      submitterName: 'User',
      destinations: ['Twitter/X', 'Facebook'],
      content: {
        commentary: 'Test post',
        articleLink: 'https://example.com',
        policyLinks: ['https://policy.example.com'],
        hashtags: ['auspol', 'fusion'],
      },
      sensitivity: Sensitivity.MEDIUM,
      selfApprove: false,
      approverPool: { name: 'authnational', memberIds: [] },
      initialTimerMinutes: 240,
      requiredApprovals: 2,
      status: AuthPostStatus.PENDING,
      submittedAt: FIXED_NOW,
      expiresAt: null,
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
      channelId: 'ch-1',
      messageId: 'msg-1',
      ...overrides,
    };
  }

  it('composes text from commentary + articleLink + policyLinks + hashtags', () => {
    const payload = buildFedicaPayload(makeSubmission());
    expect(payload.text).toContain('Test post');
    expect(payload.text).toContain('https://example.com');
    expect(payload.text).toContain('See our policy here: https://policy.example.com');
    expect(payload.text).toContain('#auspol');
    expect(payload.text).toContain('#fusion');
  });

  it('sets imageRequired=true when Facebook or Instagram is a destination', () => {
    const withFb = buildFedicaPayload(makeSubmission({ destinations: ['Facebook'] }));
    expect(withFb.imageRequired).toBe(true);
    const withIg = buildFedicaPayload(makeSubmission({ destinations: ['Instagram'] }));
    expect(withIg.imageRequired).toBe(true);
    const twitterOnly = buildFedicaPayload(makeSubmission({ destinations: ['Twitter/X'] }));
    expect(twitterOnly.imageRequired).toBe(false);
  });

  it('uses submission.scheduledAt when provided', () => {
    const sched = new Date('2026-07-05T23:00:00Z');
    const payload = buildFedicaPayload(makeSubmission({ scheduledAt: sched }));
    expect(payload.scheduledAt).toEqual(sched);
  });

  it('defaults scheduledAt to next weekday 9am AEST when not set', () => {
    const payload = buildFedicaPayload(makeSubmission());
    // FIXED_NOW = Wed 2026-07-01 12:00 UTC → next weekday 9am AEST = Thu 2026-07-01T23:00Z
    expect(payload.scheduledAt.toISOString()).toBe('2026-07-01T23:00:00.000Z');
  });
});
