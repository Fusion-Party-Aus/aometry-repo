import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateDynamicTimer,
  checkSupermajorityBypass,
  checkInstantResolution,
  addVote,
  formatTimerDuration,
  formatTimerCalculation,
  getTimeRemaining,
} from './calculator';
import {
  NcapSubmission,
  NcapVote,
  NcapStatus,
  GantryState,
  VoteType,
  TimerCalculation,
  ApproverPool,
} from './types';

const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// T = 1000 min; floor = 500, ceiling = 2000, natural threshold = 250
const T = 1000;
const POOL = ['u1', 'u2', 'u3', 'u4'];

function makeVotes(userIds: string[], type: VoteType, postId = 'NCAP-1'): NcapVote[] {
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

function makeSubmission(overrides: Partial<NcapSubmission> = {}): NcapSubmission {
  return {
    id: 'NCAP-1',
    title: 'Test',
    description: 'Test',
    category: 'Communications (Urgent)',
    proposerId: 'proposer',
    proposerName: 'Proposer',
    approverPool: { type: 'working_group', name: 'Comms', memberIds: [...POOL] } as ApproverPool,
    initialTimerMinutes: T,
    urgency: 'standard',
    status: NcapStatus.PENDING,
    submittedAt: new Date(0),
    expiresAt: new Date(T * 60 * 1000),
    resolvedAt: null,
    approveVotes: [],
    objectVotes: [],
    timerCalculation: makeTimerCalc(),
    channelId: 'ch-1',
    messageId: 'msg-1',
    ...overrides,
  };
}

describe('calculateDynamicTimer', () => {
  it('no votes → modifier 1.0, no gantry', () => {
    const calc = calculateDynamicTimer(T, [], [], POOL.length);
    expect(calc.timerModifier).toBe(1.0);
    expect(calc.currentTimerMinutes).toBe(T);
    expect(calc.clampedTimerMinutes).toBe(T);
    expect(calc.gantryState).toBe(GantryState.NONE);
    expect(calc.gantryExpiresAt).toBeNull();
  });

  it('100% approval → hits floor, VOTED_APPROVAL gantry', () => {
    const approves = makeVotes(POOL, VoteType.APPROVE);
    const calc = calculateDynamicTimer(T, approves, [], POOL.length);
    // modifier = 1 - 0.5*1 = 0.5; currentTimer = 500 = floor
    expect(calc.timerModifier).toBe(0.5);
    expect(calc.clampedTimerMinutes).toBe(T * 0.5);
    expect(calc.gantryState).toBe(GantryState.VOTED_APPROVAL);
    expect(calc.gantryExpiresAt).toEqual(new Date(FIXED_NOW.getTime() + T * 0.5 * 60 * 1000));
  });

  it('100% objection → hits ceiling, OBJECTION gantry', () => {
    const objects = makeVotes(POOL, VoteType.OBJECT);
    const calc = calculateDynamicTimer(T, [], objects, POOL.length);
    // modifier = 1 + 1.0*1 = 2.0; currentTimer = 2000 = ceiling
    expect(calc.timerModifier).toBe(2.0);
    expect(calc.clampedTimerMinutes).toBe(T * 2);
    expect(calc.gantryState).toBe(GantryState.OBJECTION);
    // objection gantry duration = T * 0.25
    expect(calc.gantryExpiresAt).toEqual(new Date(FIXED_NOW.getTime() + T * 0.25 * 60 * 1000));
  });

  it('50% approval → modifier 0.75, timer 750, no gantry', () => {
    const approves = makeVotes(['u1', 'u2'], VoteType.APPROVE);
    const calc = calculateDynamicTimer(T, approves, [], POOL.length);
    expect(calc.timerModifier).toBe(0.75);
    expect(calc.clampedTimerMinutes).toBe(750);
    expect(calc.gantryState).toBe(GantryState.NONE);
  });

  it('mixed votes reduce timer correctly', () => {
    // 2 approve (50%) + 1 object (25%): modifier = 1 - 0.5*0.5 + 1.0*0.25 = 1.0
    const approves = makeVotes(['u1', 'u2'], VoteType.APPROVE);
    const objects = makeVotes(['u3'], VoteType.OBJECT);
    const calc = calculateDynamicTimer(T, approves, objects, POOL.length);
    expect(calc.timerModifier).toBeCloseTo(1.0);
    expect(calc.gantryState).toBe(GantryState.NONE);
  });

  it('pool size 0 → rates are 0, no gantry', () => {
    const calc = calculateDynamicTimer(T, [], [], 0);
    expect(calc.approvalRate).toBe(0);
    expect(calc.objectionRate).toBe(0);
    expect(calc.gantryState).toBe(GantryState.NONE);
  });

  it('floor and ceiling are T×0.5 and T×2', () => {
    const calc = calculateDynamicTimer(T, [], [], POOL.length);
    expect(calc.floor).toBe(500);
    expect(calc.ceiling).toBe(2000);
  });
});

describe('checkSupermajorityBypass', () => {
  it('3/4 = 75% → true', () => {
    expect(checkSupermajorityBypass(makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE), 4)).toBe(true);
  });

  it('4/5 = 80% → true; 3/5 = 60% → false', () => {
    expect(checkSupermajorityBypass(makeVotes(['u1','u2','u3','u4'], VoteType.APPROVE), 5)).toBe(true);
    expect(checkSupermajorityBypass(makeVotes(['u1','u2','u3'], VoteType.APPROVE), 5)).toBe(false);
  });

  it('2/4 = 50% → false', () => {
    expect(checkSupermajorityBypass(makeVotes(['u1', 'u2'], VoteType.APPROVE), 4)).toBe(false);
  });

  it('pool size 0 → false', () => {
    expect(checkSupermajorityBypass([], 0)).toBe(false);
  });
});

describe('checkInstantResolution', () => {
  it('supermajority bypass at any gantry state', () => {
    const approves = makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.NONE, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('supermajority_bypass');
    expect(result?.finalVoteCount.approves).toBe(3);
  });

  it('approve during VOTED_APPROVAL gantry → approval_gantry_approve', () => {
    const approves = makeVotes(['u1'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.VOTED_APPROVAL, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('approval_gantry_approve');
    expect(result?.triggeredBy).toBe('u1');
  });

  it('approve during NATURAL_APPROVAL gantry → approval_gantry_approve', () => {
    const approves = makeVotes(['u1'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.NATURAL_APPROVAL, VoteType.APPROVE, approves, [], 4);
    expect(result?.type).toBe('approval_gantry_approve');
  });

  it('object during OBJECTION gantry → objection_gantry_object', () => {
    const objects = makeVotes(['u1'], VoteType.OBJECT);
    const result = checkInstantResolution(GantryState.OBJECTION, VoteType.OBJECT, [], objects, 4);
    expect(result?.type).toBe('objection_gantry_object');
    expect(result?.triggeredBy).toBe('u1');
  });

  it('no gantry and no supermajority → null', () => {
    const result = checkInstantResolution(GantryState.NONE, VoteType.APPROVE, [], [], 4);
    expect(result).toBeNull();
  });

  it('approve during OBJECTION gantry (no supermajority) → null', () => {
    const approves = makeVotes(['u1'], VoteType.APPROVE);
    const result = checkInstantResolution(GantryState.OBJECTION, VoteType.APPROVE, approves, [], 4);
    expect(result).toBeNull();
  });

  it('object during VOTED_APPROVAL gantry → null', () => {
    const objects = makeVotes(['u1'], VoteType.OBJECT);
    const result = checkInstantResolution(GantryState.VOTED_APPROVAL, VoteType.OBJECT, [], objects, 4);
    expect(result).toBeNull();
  });
});

describe('addVote', () => {
  it('proposer cannot vote on own submission', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'proposer', 'Proposer', VoteType.APPROVE);
    expect(result.error).toMatch(/[Pp]roposer/);
    expect(result.submission.approveVotes).toHaveLength(0);
  });

  it('non-member cannot vote', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'outsider', 'Outsider', VoteType.APPROVE);
    expect(result.error).toMatch(/approver pool/i);
  });

  it('cannot vote twice (approve then approve)', () => {
    const existing = makeVotes(['u1'], VoteType.APPROVE);
    const sub = makeSubmission({ approveVotes: existing });
    const result = addVote(sub, 'u1', 'User1', VoteType.OBJECT);
    expect(result.error).toMatch(/[Cc]annot change vote/);
  });

  it('cannot vote twice (object then approve)', () => {
    const existing = makeVotes(['u1'], VoteType.OBJECT);
    const sub = makeSubmission({ objectVotes: existing });
    const result = addVote(sub, 'u1', 'User1', VoteType.APPROVE);
    expect(result.error).toMatch(/[Cc]annot change vote/);
  });

  it('valid approve vote is recorded and timer recalculated', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'u1', 'User1', VoteType.APPROVE);
    expect(result.error).toBeUndefined();
    expect(result.submission.approveVotes).toHaveLength(1);
    expect(result.submission.approveVotes[0].userId).toBe('u1');
    // timer should be recalculated (1 approve from pool of 4 → modifier 0.875)
    expect(result.submission.timerCalculation.approvalRate).toBeCloseTo(0.25);
  });

  it('valid object vote is recorded', () => {
    const sub = makeSubmission();
    const result = addVote(sub, 'u1', 'User1', VoteType.OBJECT);
    expect(result.error).toBeUndefined();
    expect(result.submission.objectVotes).toHaveLength(1);
  });

  it('instant resolution returned when supermajority reached', () => {
    // 3 existing approvals, 4th triggers supermajority
    const existing = makeVotes(['u1', 'u2', 'u3'], VoteType.APPROVE);
    const sub = makeSubmission({ approveVotes: existing });
    const result = addVote(sub, 'u4', 'User4', VoteType.APPROVE);
    expect(result.instantResolution?.type).toBe('supermajority_bypass');
  });
});

describe('getTimeRemaining', () => {
  it('returns minutes until expiry', () => {
    const expiry = new Date(FIXED_NOW.getTime() + 90 * 60 * 1000); // 90 min from now
    const sub = makeSubmission({ expiresAt: expiry });
    expect(getTimeRemaining(sub)).toBe(90);
  });

  it('returns 0 when already expired', () => {
    const expiry = new Date(FIXED_NOW.getTime() - 1000);
    const sub = makeSubmission({ expiresAt: expiry });
    expect(getTimeRemaining(sub)).toBe(0);
  });

  it('returns 0 when no expiresAt', () => {
    const sub = makeSubmission({ expiresAt: null });
    expect(getTimeRemaining(sub)).toBe(0);
  });
});

describe('formatTimerDuration', () => {
  it('< 60 min → "Xm"', () => {
    expect(formatTimerDuration(45)).toBe('45m');
    expect(formatTimerDuration(0)).toBe('0m');
  });

  it('exactly 60 min → "1h"', () => {
    expect(formatTimerDuration(60)).toBe('1h');
  });

  it('hours with remainder → "Xh Ym"', () => {
    expect(formatTimerDuration(90)).toBe('1h 30m');
  });

  it('whole hours → "Xh"', () => {
    expect(formatTimerDuration(120)).toBe('2h');
  });

  it('≥ 1440 min → days', () => {
    expect(formatTimerDuration(1440)).toBe('1d');
    expect(formatTimerDuration(1500)).toBe('1d 1h');
  });
});
