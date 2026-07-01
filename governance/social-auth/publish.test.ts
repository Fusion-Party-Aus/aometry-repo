import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseScheduleFromText, nextWeekdayAt9amAest, buildFedicaPayload, composePostText, validatePostForDestinations, weightedTweetLength } from './publish';
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

  it('returns null for an impossible calendar month', () => {
    // Month 13 must not silently roll over into the next year.
    expect(parseScheduleFromText('schedule: 2026-13-01T09:00')).toBeNull();
  });

  it('returns null for an impossible calendar day', () => {
    // 30 February must not silently roll forward into March.
    expect(parseScheduleFromText('schedule: 2026-02-30T09:00')).toBeNull();
  });

  it('returns null for a time inside the Sydney DST spring-forward gap', () => {
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    // 2026-10-04 02:30 does not exist in Sydney — clocks jump 02:00 → 03:00.
    expect(parseScheduleFromText('schedule: 2026-10-04T02:30')).toBeNull();
  });
});

describe('weightedTweetLength', () => {
  it('counts plain ASCII text by character', () => {
    expect(weightedTweetLength('Hello world')).toBe(11);
  });

  it('weights a URL as 23 characters regardless of its real length', () => {
    const url = 'https://example.com/a/very/long/path?with=query&params=here';
    expect(url.length).toBeGreaterThan(23);
    expect(weightedTweetLength(url)).toBe(23);
  });

  it('weights each URL at 23 and adds surrounding text', () => {
    // "See: " (5) + url(23) + " and " (5) + url(23) = 56
    const text = 'See: https://a.example.com/xxxxxxxxxxxxxxxxxxxx and https://b.example.com/yyyyyyyyyyyyyyyy';
    expect(weightedTweetLength(text)).toBe(56);
  });

  it('counts a multi-code-unit emoji as a single code point pair, not UTF-16 units', () => {
    // A short post with an emoji must not be over-counted into a false positive.
    const text = 'Fusion 🎉';
    expect(weightedTweetLength(text)).toBeLessThanOrEqual(text.length);
  });
});

describe('nextWeekdayAt9amAest', () => {
  it('returns a future date', () => {
    const d = nextWeekdayAt9amAest();
    expect(d.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('falls on a weekday (Mon–Fri) at 09:00 Sydney time', () => {
    const d = nextWeekdayAt9amAest();
    const fmt = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)!.value;
    expect(parseInt(get('hour'), 10) % 24).toBe(9);
    expect(get('minute')).toBe('00');
    expect(['Sun', 'Sat']).not.toContain(get('weekday'));
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

  it('uses AEDT offset (UTC+11) during Australian summer (January)', () => {
    // 2026-01-15 12:00 UTC = 23:00 AEDT (UTC+11) — still Thursday
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const d = nextWeekdayAt9amAest();
    // Next weekday 9am AEDT = Fri 2026-01-16 09:00 AEDT = 2026-01-15T22:00:00Z (UTC+11)
    expect(d.toISOString()).toBe('2026-01-15T22:00:00.000Z');
  });
});

describe('parseScheduleFromText AEDT', () => {
  it('interprets schedule datetime using Sydney local time (AEDT in January)', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    // 2026-01-15T09:00 in Sydney = AEDT = UTC+11 → 2026-01-14T22:00Z
    const d = parseScheduleFromText('schedule: 2026-01-15T09:00');
    expect(d?.toISOString()).toBe('2026-01-14T22:00:00.000Z');
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

  it('omits article link when null', () => {
    const payload = buildFedicaPayload(makeSubmission({
      content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] },
    }));
    expect(payload.text).toBe('Hello');
  });

  it('omits policy links when empty', () => {
    const payload = buildFedicaPayload(makeSubmission({
      content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] },
    }));
    expect(payload.text).not.toContain('policy');
  });

  it('omits hashtags when empty', () => {
    const payload = buildFedicaPayload(makeSubmission({
      content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] },
    }));
    expect(payload.text).not.toContain('#');
  });

  it('passes through postId and destinations', () => {
    const payload = buildFedicaPayload(makeSubmission());
    expect(payload.postId).toBe('AUTH-2026-001');
    expect(payload.destinations).toEqual(['Twitter/X', 'Facebook']);
  });

  it('multiple policy links each get prefix', () => {
    const sub = makeSubmission({
      content: {
        commentary: 'Hi',
        articleLink: null,
        policyLinks: ['https://fusionparty.org.au/climate_rescue', 'https://fusionparty.org.au/future_focused'],
        hashtags: [],
      },
    });
    const payload = buildFedicaPayload(sub);
    expect(payload.text.match(/See our policy here:/g)).toHaveLength(2);
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

describe('composePostText', () => {
  it('commentary only', () => {
    const text = composePostText({ commentary: 'Hello world', articleLink: null, policyLinks: [], hashtags: [] });
    expect(text).toBe('Hello world');
  });

  it('appends article link on new line', () => {
    const text = composePostText({ commentary: 'Hi', articleLink: 'https://example.com', policyLinks: [], hashtags: [] });
    expect(text).toBe('Hi\nhttps://example.com');
  });

  it('appends each policy link on new line', () => {
    const text = composePostText({ commentary: 'Hi', articleLink: null, policyLinks: ['https://a.com', 'https://b.com'], hashtags: [] });
    expect(text).toContain('https://a.com');
    expect(text).toContain('https://b.com');
  });

  it('appends hashtags prefixed with #', () => {
    const text = composePostText({ commentary: 'Hi', articleLink: null, policyLinks: [], hashtags: ['auspol', 'fusionparty'] });
    expect(text).toContain('#auspol');
    expect(text).toContain('#fusionparty');
  });

  it('full composition matches buildFedicaPayload text', () => {
    const content = { commentary: 'Test post', articleLink: 'https://example.com', policyLinks: ['https://policy.com'], hashtags: ['auspol'] };
    const composed = composePostText(content);
    expect(composed).toBe('Test post\nhttps://example.com\nSee our policy here: https://policy.com\n#auspol');
  });
});

describe('validatePostForDestinations', () => {
  const shortContent = { commentary: 'Short post', articleLink: null, policyLinks: [], hashtags: ['auspol'] };
  const longCommentary = 'A'.repeat(281);
  const longContent = { commentary: longCommentary, articleLink: null, policyLinks: [], hashtags: [] };

  it('returns empty array for valid short post to Twitter/X', () => {
    const errors = validatePostForDestinations(shortContent, ['Twitter/X']);
    expect(errors).toHaveLength(0);
  });

  it('returns a char-limit error when composed text exceeds 280 chars for Twitter/X', () => {
    const errors = validatePostForDestinations(longContent, ['Twitter/X']);
    expect(errors.some(e => e.includes('280'))).toBe(true);
  });

  it('does not flag char limit for non-Twitter destinations', () => {
    const errors = validatePostForDestinations(longContent, ['Facebook']);
    expect(errors.every(e => !e.includes('280'))).toBe(true);
  });

  it('returns image warning when Facebook is a destination', () => {
    const errors = validatePostForDestinations(shortContent, ['Facebook']);
    expect(errors.some(e => e.toLowerCase().includes('image'))).toBe(true);
  });

  it('returns image warning when Instagram is a destination', () => {
    const errors = validatePostForDestinations(shortContent, ['Instagram']);
    expect(errors.some(e => e.toLowerCase().includes('image'))).toBe(true);
  });

  it('no image warning for Twitter/X only', () => {
    const errors = validatePostForDestinations(shortContent, ['Twitter/X']);
    expect(errors.every(e => !e.toLowerCase().includes('image'))).toBe(true);
  });

  it('flags both char limit and image warning together', () => {
    const errors = validatePostForDestinations(longContent, ['Twitter/X', 'Facebook']);
    expect(errors.some(e => e.includes('280'))).toBe(true);
    expect(errors.some(e => e.toLowerCase().includes('image'))).toBe(true);
  });

  it('char limit error includes actual character count', () => {
    const errors = validatePostForDestinations(longContent, ['Twitter/X']);
    const charError = errors.find(e => e.includes('280'))!;
    expect(charError).toContain(String(weightedTweetLength(composePostText(longContent))));
  });

  it('does not flag a URL-heavy but short post that only exceeds 280 by raw length', () => {
    // Three long URLs raw-count well over 280, but weighted they are 23 each (~75 + text).
    const urlHeavy = {
      commentary: 'Read our three latest policy pieces:',
      articleLink: 'https://www.fusionparty.org.au/climate_rescue_full_detailed_explainer_page',
      policyLinks: [
        'https://www.fusionparty.org.au/future_focused_full_detailed_explainer_page',
        'https://www.fusionparty.org.au/education_for_life_full_detailed_explainer_page',
      ],
      hashtags: ['auspol'],
    };
    expect(composePostText(urlHeavy).length).toBeGreaterThan(280);
    const errors = validatePostForDestinations(urlHeavy, ['Twitter/X']);
    expect(errors.some(e => e.includes('280'))).toBe(false);
  });
});
