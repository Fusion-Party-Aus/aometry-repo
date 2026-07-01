import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateDynamicTimer,
  checkSupermajorityBypass,
  checkApprovalThresholdMet,
  checkInstantResolution,
  addVote,
  formatTimerDuration,
  getTimeRemaining,
  updateSubmissionTimer,
  resolveEffectiveSensitivity,
  resolvePublishMode,
  isHoldPublishDue,
} from './calculator';
import {
  SocialAuthSubmission,
  AuthPostVote,
  AuthPostStatus,
  GantryState,
  VoteType,
  Sensitivity,
  TimerCalculation,
  ApproverPool,
  PostContent,
} from './types';

const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const T = 1000;
const POOL_IDS = ['u1', 'u2', 'u3', 'u4'];

function makeVotes(userIds: string[], type: VoteType, postId = 'AUTH-1'): AuthPostVote[] {
  return userIds.map((userId, i) => ({
    id: i + 1,
    postId,
    userId,
    userName: userId,
    voteType: type,
    timestamp: new Date(),
  }));
}

function makeTimerCalc(overrides: Partial<TimerCalculation> = {}): TimerCalculation {
  return {
    initialTimerMinutes: T,
    approvalRate: 0,
    objectionRate: 0,
    timerModifier: 1.0,
    currentTimerMinutes: T,
    floor: T * 0.5,
    ceiling: T * 2,
    clampedTimerMinutes: T,
    gantryState: GantryState.NONE,
    gantryExpiresAt: null,
    ...overrides,
  };
}

const CONTENT: PostContent = {
  commentary: 'Test post',
  articleLink: null,
  policyLinks: [],
  hashtags: [],
};

function makeSubmission(overrides: Partial<SocialAuthSubmission> = {}): SocialAuthSubmission {
  return {
    id: 'AUTH-1',
    submitterId: 'submitter',
    submitterName: 'Submitter',
    destinations: ['Twitter/X'],
    content: CONTENT,
    sensitivity: Sensitivity.MEDIUM,
    selfApprove: false,
    approverPool: { name: 'authnational', memberIds: [...POOL_IDS] } as ApproverPool,
    initialTimerMinutes: T,
    requiredApprovals: 2,
    status: AuthPostStatus.PENDING,
    submittedAt: new Date(0),
    expiresAt: new Date(T * 60 * 1000),
    resolvedAt: null,
    publishedAt: null,
    approveVotes: [],
    objectVotes: [],
    edits: [],
    timerCalculation: makeTimerCalc(),
    channelId: 'ch-1',
    messageId: 'msg-1',
    ...overrides,
  };
}

describe('calculateDynamicTimer', () => {
  it('no votes → modifier 1.0, no gantry', () => {
    const calc = calculateDynamicTimer(T, [], [], POOL_IDS.length);
    expect(calc.timerModifier).toBe(1.0);
    expect(calc.clampedTimerMinutes).toBe(T);
    expect(calc.gantryState).toBe(GantryState.NONE);
    expect(calc.gantryExpiresAt).toBeNull();
  });

  it('100% approval → floor hit, VOTED_APPROVAL gantry', () => {
    const approves = makeVotes(POOL_IDS, VoteType.APPROVE);
    const calc = calculateDynamicTimer(T, approves, [], POOL_IDS.length);
    expect(calc.clampedTimerMinutes).toBe(T * 0.5);
    expect(calc.gantryState).toBe(GantryState.VOTED_APPROVAL);
    expect(calc.gantryExpiresAt).toEqual(new Date(FIXED_NOW.getTime() + T * 0.5 * 60 * 1000));
  });

  it('100% objection → ceiling hit, OBJECTION gantry', () => {
    const objects = makeVotes(POOL_IDS, VoteType.OBJECT);
    const calc = calculateDynamicTimer(T, [], objects, POOL_IDS.length);
    expect(calc.clampedTimerMinutes).toBe(T * 2);
    expect(calc.gantryState).toBe(GantryState.OBJECTION);
    expect(calc.gantryExpiresAt).toEqual(new Date(FIXED_NOW.getTime() + T * 0.25 * 60 * 1000));
  });

  it('50% approval → modifier 0.75, no gantry', () => {
    const approves = makeVotes(['u1', 'u2'], VoteType.APPROVE);
    const calc = calculateDynamicTimer(T, approves, [], POOL_IDS.length);
    expect(calc.timerModifier).toBe(0.75);
    expect(calc.clampedTimerMinutes).toBe(750);
    expect(calc.gantryState).toBe(GantryState.NONE);
  });
});

describe('checkApprovalThresholdMet', () => {
  it('votes >= required → true', () => {
    expect(checkApprovalThresholdMet(makeVotes(['u1', 'u2'], VoteType.APPROVE), 2)).toBe(true);
    expect(checkApprovalThresholdMet(makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE), 2)).toBe(true);
  });

  it('votes < required → false', () => {
    expect(checkApprovalThresholdMet(makeVotes(['u1'], VoteType.APPROVE), 2)).toBe(false);
    expect(checkApprovalThresholdMet([], 1)).toBe(false);
  });

  it('threshold of 1 with self-approve pattern', () => {
    expect(checkApprovalThresholdMet(makeVotes(['submitter'], VoteType.APPROVE), 1)).toBe(true);
  });
});

describe('checkSupermajorityBypass', () => {
  it('3/4 = 75% → true', () => {
    expect(checkSupermajorityBypass(makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE), 4)).toBe(true);
  });

  it('2/4 = 50% → false', () => {
    expect(checkSupermajorityBypass(makeVotes(['u1', 'u2'], VoteType.APPROVE), 4)).toBe(false);
  });

  it('pool size 0 → false', () => {
    expect(checkSupermajorityBypass([], 0)).toBe(false);
  });
});

describe('checkInstantResolution', () => {
  it('supermajority triggers bypass regardless of gantry state', () => {
    const approves = makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.NONE, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('supermajority_bypass');
  });

  it('approve in VOTED_APPROVAL gantry → approval_gantry_approve', () => {
    const approves = makeVotes(['u1'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.VOTED_APPROVAL, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('approval_gantry_approve');
  });

  it('approve in NATURAL_APPROVAL gantry → approval_gantry_approve', () => {
    const approves = makeVotes(['u1'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.NATURAL_APPROVAL, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('approval_gantry_approve');
  });

  it('object in OBJECTION gantry → objection_gantry_object', () => {
    const objects = makeVotes(['u1'], VoteType.OBJECT);
    const result = checkInstantResolution(GantryState.OBJECTION, VoteType.OBJECT, [], objects, 4);
    expect(result?.type).toBe('objection_gantry_object');
  });

  it('no triggering condition → null', () => {
    const result = checkInstantResolution(GantryState.NONE, VoteType.APPROVE, [], [], 4);
    expect(result).toBeNull();
  });
});

describe('addVote — vote eligibility', () => {
  it('non-member who is not submitter is blocked', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'outsider', 'Outsider', VoteType.APPROVE);
    expect(result.error).toMatch(/@authnational/i);
    expect(result.submission.approveVotes).toHaveLength(0);
  });

  it('submitter cannot approve when selfApprove=false', () => {
    const sub = makeSubmission({ selfApprove: false });
    const result = addVote(sub, 'submitter', 'Submitter', VoteType.APPROVE);
    expect(result.error).toMatch(/self-approv/i);
  });

  it('submitter can approve when selfApprove=true', () => {
    const sub = makeSubmission({ selfApprove: true, requiredApprovals: 1 });
    const result = addVote(sub, 'submitter', 'Submitter', VoteType.APPROVE);
    expect(result.error).toBeUndefined();
    expect(result.submission.approveVotes).toHaveLength(1);
  });

  it('submitter can object even when selfApprove=false', () => {
    const sub = makeSubmission({ selfApprove: false });
    const result = addVote(sub, 'submitter', 'Submitter', VoteType.OBJECT);
    expect(result.error).toBeUndefined();
    expect(result.submission.objectVotes).toHaveLength(1);
  });

  it('cannot change vote once cast', () => {
    const existing = makeVotes(['u1'], VoteType.APPROVE);
    const sub = makeSubmission({ approveVotes: existing });
    const result = addVote(sub, 'u1', 'User1', VoteType.OBJECT);
    expect(result.error).toMatch(/[Cc]annot change vote/);
  });

  it('pool member can cast approve vote', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'u1', 'User1', VoteType.APPROVE);
    expect(result.error).toBeUndefined();
    expect(result.submission.approveVotes).toHaveLength(1);
    expect(result.submission.approveVotes[0].userId).toBe('u1');
  });

  it('pool member can cast object vote', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'u1', 'User1', VoteType.OBJECT);
    expect(result.error).toBeUndefined();
    expect(result.submission.objectVotes).toHaveLength(1);
  });

  it('instant resolution returned on supermajority', () => {
    const existing = makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE);
    const sub = makeSubmission({ approveVotes: existing });
    const result = addVote(sub, 'u4', 'User4', VoteType.APPROVE);
    expect(result.instantResolution?.type).toBe('supermajority_bypass');
  });

  it('timer is recalculated after vote', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'u1', 'User1', VoteType.APPROVE);
    // 1/4 = 25% approval, modifier = 1 - 0.5*0.25 = 0.875
    expect(result.submission.timerCalculation.timerModifier).toBeCloseTo(0.875);
  });
});

describe('getTimeRemaining', () => {
  it('returns minutes until expiry', () => {
    const sub = makeSubmission({ expiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000) });
    expect(getTimeRemaining(sub)).toBe(60);
  });

  it('returns 0 when already expired', () => {
    const sub = makeSubmission({ expiresAt: new Date(FIXED_NOW.getTime() - 1000) });
    expect(getTimeRemaining(sub)).toBe(0);
  });

  it('returns 0 when expiresAt is null', () => {
    const sub = makeSubmission({ expiresAt: null });
    expect(getTimeRemaining(sub)).toBe(0);
  });
});

describe('formatTimerDuration', () => {
  it('< 60 min → "Xm"', () => {
    expect(formatTimerDuration(30)).toBe('30m');
    expect(formatTimerDuration(0)).toBe('0m');
  });

  it('exactly 60 min → "1h"', () => {
    expect(formatTimerDuration(60)).toBe('1h');
  });

  it('hours with minutes → "Xh Ym"', () => {
    expect(formatTimerDuration(90)).toBe('1h 30m');
  });

  it('whole hours → "Xh"', () => {
    expect(formatTimerDuration(180)).toBe('3h');
  });

  it('days without hours → "Xd"', () => {
    expect(formatTimerDuration(1440)).toBe('1d');
  });

  it('days with hours → "Xd Yh"', () => {
    expect(formatTimerDuration(1500)).toBe('1d 1h');
  });
});

describe('updateSubmissionTimer — NATURAL_APPROVAL gantry', () => {
  it('enters NATURAL_APPROVAL when remaining ≤ 25% of initial timer', () => {
    // initialTimerMinutes = T=1000, 25% threshold = 250 min
    // Set submittedAt so that expiresAt is 200 min from FIXED_NOW (< 250 → should trigger)
    const submittedAt = new Date(FIXED_NOW.getTime() - (1000 - 200) * 60000);
    const sub = makeSubmission({ submittedAt, expiresAt: new Date(FIXED_NOW.getTime() + 200 * 60000) });
    const updated = updateSubmissionTimer(sub);
    expect(updated.timerCalculation.gantryState).toBe(GantryState.NATURAL_APPROVAL);
    expect(updated.timerCalculation.gantryExpiresAt).toEqual(updated.expiresAt);
  });

  it('does NOT enter NATURAL_APPROVAL when remaining > 25% of initial timer', () => {
    // 300 min remaining with T=1000 → 30% > 25%, should stay NONE
    const submittedAt = new Date(FIXED_NOW.getTime() - (1000 - 300) * 60000);
    const sub = makeSubmission({ submittedAt, expiresAt: new Date(FIXED_NOW.getTime() + 300 * 60000) });
    const updated = updateSubmissionTimer(sub);
    expect(updated.timerCalculation.gantryState).toBe(GantryState.NONE);
  });

  it('does NOT override VOTED_APPROVAL gantry even if remaining ≤ 25%', () => {
    // Full pool approval pushes timer to floor → VOTED_APPROVAL gantry from vote calc
    const approves = makeVotes(POOL_IDS, VoteType.APPROVE);
    const submittedAt = new Date(FIXED_NOW.getTime() - (1000 - 100) * 60000);
    const sub = makeSubmission({
      approveVotes: approves,
      submittedAt,
      expiresAt: new Date(FIXED_NOW.getTime() + 100 * 60000),
    });
    const updated = updateSubmissionTimer(sub);
    expect(updated.timerCalculation.gantryState).toBe(GantryState.VOTED_APPROVAL);
  });

  it('does NOT enter NATURAL_APPROVAL when timer has already expired', () => {
    const submittedAt = new Date(FIXED_NOW.getTime() - 1100 * 60000);
    const sub = makeSubmission({ submittedAt, expiresAt: new Date(FIXED_NOW.getTime() - 100 * 60000) });
    const updated = updateSubmissionTimer(sub);
    // expired → remainingMs ≤ 0, so no natural gantry
    expect(updated.timerCalculation.gantryState).toBe(GantryState.NONE);
  });
});

describe('resolveEffectiveSensitivity', () => {
  const { LOW, MEDIUM, HIGH } = Sensitivity;

  it('agree → uses submitter sensitivity unchanged', () => {
    expect(resolveEffectiveSensitivity(LOW, LOW, 'agree')).toBe(LOW);
    expect(resolveEffectiveSensitivity(MEDIUM, MEDIUM, 'agree')).toBe(MEDIUM);
    expect(resolveEffectiveSensitivity(HIGH, HIGH, 'agree')).toBe(HIGH);
  });

  it('escalate → uses AI suggested sensitivity', () => {
    expect(resolveEffectiveSensitivity(LOW, MEDIUM, 'escalate')).toBe(MEDIUM);
    expect(resolveEffectiveSensitivity(LOW, HIGH, 'escalate')).toBe(HIGH);
    expect(resolveEffectiveSensitivity(MEDIUM, HIGH, 'escalate')).toBe(HIGH);
  });

  it('downgrade → keeps submitter sensitivity (advisory only)', () => {
    expect(resolveEffectiveSensitivity(MEDIUM, LOW, 'downgrade')).toBe(MEDIUM);
    expect(resolveEffectiveSensitivity(HIGH, MEDIUM, 'downgrade')).toBe(HIGH);
    expect(resolveEffectiveSensitivity(HIGH, LOW, 'downgrade')).toBe(HIGH);
  });

  it('escalate with same level → no change', () => {
    expect(resolveEffectiveSensitivity(HIGH, HIGH, 'escalate')).toBe(HIGH);
  });
});

describe('resolvePublishMode', () => {
  const { LOW, MEDIUM, HIGH } = Sensitivity;

  it('HIGH → always manual', () => {
    expect(resolvePublishMode(HIGH, false, false)).toBe('manual');
    expect(resolvePublishMode(HIGH, true, true)).toBe('manual');
    expect(resolvePublishMode(HIGH, false, true)).toBe('manual');
  });

  it('MEDIUM + supermajority → hold', () => {
    expect(resolvePublishMode(MEDIUM, false, true)).toBe('hold');
  });

  it('MEDIUM + normal approval → manual', () => {
    expect(resolvePublishMode(MEDIUM, false, false)).toBe('manual');
    expect(resolvePublishMode(MEDIUM, true, false)).toBe('manual');
  });

  it('LOW + no objections → auto', () => {
    expect(resolvePublishMode(LOW, false, false)).toBe('auto');
    expect(resolvePublishMode(LOW, false, true)).toBe('auto');
  });

  it('LOW + had objections → hold', () => {
    expect(resolvePublishMode(LOW, true, false)).toBe('hold');
    expect(resolvePublishMode(LOW, true, true)).toBe('hold');
  });
});

describe('isHoldPublishDue', () => {
  it('returns true when scheduledAt is in the past', () => {
    const past = new Date(FIXED_NOW.getTime() - 1);
    expect(isHoldPublishDue(past)).toBe(true);
  });

  it('returns true when scheduledAt equals now exactly', () => {
    expect(isHoldPublishDue(new Date(FIXED_NOW.getTime()))).toBe(true);
  });

  it('returns false when scheduledAt is in the future', () => {
    const future = new Date(FIXED_NOW.getTime() + 1000);
    expect(isHoldPublishDue(future)).toBe(false);
  });

  it('returns false when scheduledAt is undefined', () => {
    expect(isHoldPublishDue(undefined)).toBe(false);
  });
});
