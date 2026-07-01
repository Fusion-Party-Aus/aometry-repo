import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseScheduleFromText, nextWeekdayAt9amAest, buildFedicaPayload, publishToFedica } from './publish';
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

function makeFullSubmission(overrides: Partial<SocialAuthSubmission> = {}): SocialAuthSubmission {
  return {
    id: 'AUTH-2026-002',
    submitterId: 'u1',
    submitterName: 'User',
    destinations: ['Twitter/X'],
    content: {
      commentary: 'Test post',
      articleLink: 'https://example.com',
      policyLinks: [],
      hashtags: [],
    },
    sensitivity: Sensitivity.MEDIUM,
    selfApprove: false,
    approverPool: { name: 'authnational', memberIds: [] },
    initialTimerMinutes: 240,
    requiredApprovals: 2,
    status: AuthPostStatus.APPROVED,
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

describe('publishToFedica — stub mode (FEDICA_API_KEY unset)', () => {
  it('logs the payload and returns a synthetic success result without calling fetch', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: any) => ({}) as any);
    vi.stubGlobal('fetch', fetchSpy);

    const submission = makeFullSubmission();
    const result = await publishToFedica(submission);

    expect(result.success).toBe(true);
    expect(result.fedicaPostId).toBe(`stub-${submission.id}`);
    // Default schedule resolves to next weekday 9am AEST since scheduledAt is unset.
    expect(result.fedicaScheduledAt?.toISOString()).toBe('2026-07-01T23:00:00.000Z');
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('uses submission.scheduledAt as fedicaScheduledAt when provided', async () => {
    const sched = new Date('2026-07-10T23:00:00Z');
    const result = await publishToFedica(makeFullSubmission({ scheduledAt: sched }));
    expect(result.fedicaScheduledAt).toEqual(sched);
  });
});

describe('publishToFedica — live mode (FEDICA_API_KEY set)', () => {
  const ORIGINAL_KEY = process.env.FEDICA_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.FEDICA_API_KEY;
    } else {
      process.env.FEDICA_API_KEY = ORIGINAL_KEY;
    }
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadLivePublish() {
    process.env.FEDICA_API_KEY = 'test-fedica-key';
    vi.resetModules();
    return import('./publish');
  }

  it('POSTs to the Fedica API with mapped platforms and returns the confirmed schedule', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
      ok: true,
      json: async () => ({ id: 'fed-123', scheduled_at: '2026-07-05T00:00:00.000Z' }),
    }) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();
    const submission = makeFullSubmission({ destinations: ['Twitter/X', 'Facebook'] });
    const result = await livePublish(submission);

    expect(result.success).toBe(true);
    expect(result.fedicaPostId).toBe('fed-123');
    expect(result.fedicaScheduledAt).toEqual(new Date('2026-07-05T00:00:00.000Z'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.fedica.com/api/posts');
    expect(options.headers.Authorization).toBe('Bearer test-fedica-key');
    const body = JSON.parse(options.body as string);
    expect(body.platforms).toEqual(['twitter', 'facebook']);
    expect(body.link).toBe('https://example.com');
  });

  it('falls back to the payload scheduledAt when the API response omits scheduled_at', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
      ok: true,
      json: async () => ({ id: 'fed-456' }),
    }) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish, nextWeekdayAt9amAest: liveNextWeekday } = await loadLivePublish();
    const submission = makeFullSubmission();
    const result = await livePublish(submission);

    expect(result.success).toBe(true);
    expect(result.fedicaScheduledAt).toEqual(liveNextWeekday());
  });

  it('returns a failure result without calling fetch when no destination maps to a Fedica platform', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ({}) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();
    const submission = makeFullSubmission({ destinations: ['Newsletter', 'Other'] });
    const result = await livePublish(submission);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No Fedica-mapped platforms/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a failure result when the API responds with a non-retryable 4xx error', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    }) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();
    const result = await livePublish(makeFullSubmission());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Fedica API 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No retry on 4xx.
  });

  it('returns a failure result when fetch itself rejects (network error)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any): Promise<any> => {
      throw new Error('network unreachable');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();
    const result = await livePublish(makeFullSubmission());

    expect(result.success).toBe(false);
    expect(result.error).toBe('network unreachable');
  });

  it('retries on transient 5xx errors and succeeds once the API recovers', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: any): Promise<any> => {
      callCount++;
      if (callCount < 3) {
        return { ok: false, status: 503, text: async () => 'Service Unavailable' };
      }
      return { ok: true, json: async () => ({ id: 'fed-789', scheduled_at: '2026-07-06T00:00:00.000Z' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();

    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const resultPromise = livePublish(makeFullSubmission());

    // Retry backoff: 1000ms after 1st failure, 2000ms after 2nd failure.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;

    expect(callCount).toBe(3);
    expect(result.success).toBe(true);
    expect(result.fedicaPostId).toBe('fed-789');
  });

  it('gives up after exhausting retries on persistent 5xx errors', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }) as any);
    vi.stubGlobal('fetch', fetchMock);

    const { publishToFedica: livePublish } = await loadLivePublish();

    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const resultPromise = livePublish(makeFullSubmission());

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Fedica API 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_RETRIES = 3
  });
});
