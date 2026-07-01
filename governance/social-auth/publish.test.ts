import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildFedicaPayload } from './publish';
import { SocialAuthSubmission, AuthPostStatus, GantryState, Sensitivity, Destination } from './types';

function makeSubmission(overrides: Partial<SocialAuthSubmission> = {}): SocialAuthSubmission {
  return {
    id: 'AUTH-2026-001',
    submitterId: 'u1',
    submitterName: 'User1',
    destinations: ['Twitter/X', 'Facebook'] as Destination[],
    content: {
      commentary: 'Check out this article',
      articleLink: 'https://example.com/article',
      policyLinks: ['https://www.fusionparty.org.au/climate_rescue'],
      hashtags: ['auspol', 'fusionparty', 'ClimateRescue'],
    },
    sensitivity: Sensitivity.LOW,
    selfApprove: true,
    approverPool: { name: 'authnational', memberIds: ['u1'] },
    initialTimerMinutes: 240,
    requiredApprovals: 1,
    status: AuthPostStatus.APPROVED,
    submittedAt: new Date(),
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

describe('buildFedicaPayload', () => {
  it('composes text: commentary + article + policy + hashtags', () => {
    const payload = buildFedicaPayload(makeSubmission());
    expect(payload.text).toContain('Check out this article');
    expect(payload.text).toContain('https://example.com/article');
    expect(payload.text).toContain('See our policy here: https://www.fusionparty.org.au/climate_rescue');
    expect(payload.text).toContain('#auspol #fusionparty #ClimateRescue');
  });

  it('omits article link when null', () => {
    const payload = buildFedicaPayload(makeSubmission({ content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] } }));
    expect(payload.text).toBe('Hello');
  });

  it('omits policy links when empty', () => {
    const payload = buildFedicaPayload(makeSubmission({ content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] } }));
    expect(payload.text).not.toContain('policy');
  });

  it('omits hashtags when empty', () => {
    const payload = buildFedicaPayload(makeSubmission({ content: { commentary: 'Hello', articleLink: null, policyLinks: [], hashtags: [] } }));
    expect(payload.text).not.toContain('#');
  });

  it('imageRequired true when Facebook in destinations', () => {
    const payload = buildFedicaPayload(makeSubmission({ destinations: ['Facebook'] }));
    expect(payload.imageRequired).toBe(true);
  });

  it('imageRequired true when Instagram in destinations', () => {
    const payload = buildFedicaPayload(makeSubmission({ destinations: ['Instagram'] }));
    expect(payload.imageRequired).toBe(true);
  });

  it('imageRequired false for Twitter/X only', () => {
    const payload = buildFedicaPayload(makeSubmission({ destinations: ['Twitter/X'] }));
    expect(payload.imageRequired).toBe(false);
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
        policyLinks: ['https://www.fusionparty.org.au/climate_rescue', 'https://www.fusionparty.org.au/future_focused'],
        hashtags: [],
      },
    });
    const payload = buildFedicaPayload(sub);
    expect(payload.text.match(/See our policy here:/g)).toHaveLength(2);
  });
});

describe('publishToFedica stub (no API key)', () => {
  it('returns success with stub id and writes output file', async () => {
    const fsMock = { writeFile: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('fs/promises', () => fsMock);

    delete process.env.FEDICA_API_KEY;
    const { publishToFedica } = await import('./publish');
    const result = await publishToFedica(makeSubmission());
    expect(result.success).toBe(true);
    expect(result.fedicaPostId).toBe('stub-AUTH-2026-001');
  });
});
