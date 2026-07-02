/**
 * Social Auth Timer Calculation Engine
 * Same dynamic timer/gantry model as governance/ncap,
 * applied to social media authorisation requests instead of NCAP submissions.
 */

import {
  SocialAuthSubmission,
  AuthPostVote,
  VoteType,
  GantryState,
  TimerCalculation,
  TIMER_CONSTANTS,
  InstantResolution,
  Sensitivity,
} from './types';

/**
 * Calculate dynamic timer based on current vote state
 */
export function calculateDynamicTimer(
  initialTimerMinutes: number,
  approveVotes: AuthPostVote[],
  objectVotes: AuthPostVote[],
  approverPoolSize: number
): TimerCalculation {
  const approvalCount = approveVotes.length;
  const objectionCount = objectVotes.length;

  const approvalRate = approverPoolSize > 0 ? approvalCount / approverPoolSize : 0;
  const objectionRate = approverPoolSize > 0 ? objectionCount / approverPoolSize : 0;

  const timerModifier = 1
    - (TIMER_CONSTANTS.APPROVAL_COEFFICIENT * approvalRate)
    + (TIMER_CONSTANTS.OBJECTION_COEFFICIENT * objectionRate);

  const currentTimerMinutes = initialTimerMinutes * timerModifier;

  const floor = initialTimerMinutes * TIMER_CONSTANTS.FLOOR_MULTIPLIER;
  const ceiling = initialTimerMinutes * TIMER_CONSTANTS.CEILING_MULTIPLIER;

  let clampedTimerMinutes = currentTimerMinutes;
  let gantryState = GantryState.NONE;
  let gantryExpiresAt: Date | null = null;

  if (currentTimerMinutes <= floor) {
    clampedTimerMinutes = floor;
    gantryState = GantryState.VOTED_APPROVAL;
    gantryExpiresAt = new Date(Date.now() + floor * 60 * 1000);
  } else if (currentTimerMinutes >= ceiling) {
    clampedTimerMinutes = ceiling;
    gantryState = GantryState.OBJECTION;
    const objectionGantryDuration = initialTimerMinutes * TIMER_CONSTANTS.NATURAL_GANTRY_THRESHOLD;
    gantryExpiresAt = new Date(Date.now() + objectionGantryDuration * 60 * 1000);
  }
  // NATURAL_APPROVAL gantry is wall-clock-based, not vote-based: it triggers when
  // the remaining time drops to ≤25% of the initial timer in updateSubmissionTimer.

  return {
    initialTimerMinutes,
    approvalRate,
    objectionRate,
    timerModifier,
    currentTimerMinutes,
    floor,
    ceiling,
    clampedTimerMinutes,
    gantryState,
    gantryExpiresAt
  };
}

/**
 * Supermajority bypass - >= 75% approval triggers immediate approval
 */
export function checkSupermajorityBypass(
  approveVotes: AuthPostVote[],
  approverPoolSize: number
): boolean {
  if (approverPoolSize === 0) return false;
  return approveVotes.length / approverPoolSize >= TIMER_CONSTANTS.SUPERMAJORITY_THRESHOLD;
}

/**
 * Required-approvals threshold met, independent of pool-rate gantry mechanics.
 * This is the actual publish gate: sensitivity tier sets requiredApprovals (e.g. 1 for
 * low/self-approve, 2+ for medium/high), and crossing it is what queues the Fedica publish.
 */
export function checkApprovalThresholdMet(
  approveVotes: AuthPostVote[],
  requiredApprovals: number
): boolean {
  return approveVotes.length >= requiredApprovals;
}

/**
 * Check for instant resolution triggers during gantry periods
 */
export function checkInstantResolution(
  gantryState: GantryState,
  newVoteType: VoteType,
  approveVotes: AuthPostVote[],
  objectVotes: AuthPostVote[],
  approverPoolSize: number
): InstantResolution | null {
  if (checkSupermajorityBypass(approveVotes, approverPoolSize)) {
    return {
      type: 'supermajority_bypass',
      triggeredAt: new Date(),
      triggeredBy: approveVotes[approveVotes.length - 1]?.userId || 'unknown',
      finalVoteCount: { approves: approveVotes.length, objects: objectVotes.length, poolSize: approverPoolSize }
    };
  }

  if ((gantryState === GantryState.NATURAL_APPROVAL || gantryState === GantryState.VOTED_APPROVAL)
      && newVoteType === VoteType.APPROVE) {
    return {
      type: 'approval_gantry_approve',
      triggeredAt: new Date(),
      triggeredBy: approveVotes[approveVotes.length - 1]?.userId || 'unknown',
      finalVoteCount: { approves: approveVotes.length, objects: objectVotes.length, poolSize: approverPoolSize }
    };
  }

  if (gantryState === GantryState.OBJECTION && newVoteType === VoteType.OBJECT) {
    return {
      type: 'objection_gantry_object',
      triggeredAt: new Date(),
      triggeredBy: objectVotes[objectVotes.length - 1]?.userId || 'unknown',
      finalVoteCount: { approves: approveVotes.length, objects: objectVotes.length, poolSize: approverPoolSize }
    };
  }

  return null;
}

/** Minutes remaining until submission.expiresAt, clamped to 0 (never negative). */
export function getTimeRemaining(submission: SocialAuthSubmission): number {
  if (!submission.expiresAt) return 0;
  const remainingMs = new Date(submission.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.floor(remainingMs / 60000));
}

/**
 * Recalculate timer/gantry state from current vote counts and wall-clock time.
 * NATURAL_APPROVAL gantry fires when remaining time ≤ 25% of the initial timer
 * and no vote-driven gantry (VOTED_APPROVAL / OBJECTION) is already active.
 */
export function updateSubmissionTimer(submission: SocialAuthSubmission): SocialAuthSubmission {
  const submittedAt = new Date(submission.submittedAt).getTime();

  const timerCalc = calculateDynamicTimer(
    submission.initialTimerMinutes,
    submission.approveVotes,
    submission.objectVotes,
    submission.approverPool.memberIds.length
  );

  const expiresAt = new Date(submittedAt + timerCalc.clampedTimerMinutes * 60000);
  const remainingMs = expiresAt.getTime() - Date.now();
  const naturalGantryMs = timerCalc.initialTimerMinutes * 60000 * TIMER_CONSTANTS.NATURAL_GANTRY_THRESHOLD;

  let finalTimerCalc = timerCalc;
  if (
    timerCalc.gantryState === GantryState.NONE &&
    remainingMs > 0 &&
    remainingMs <= naturalGantryMs
  ) {
    finalTimerCalc = { ...timerCalc, gantryState: GantryState.NATURAL_APPROVAL, gantryExpiresAt: expiresAt };
  }

  return { ...submission, timerCalculation: finalTimerCalc, expiresAt };
}

/**
 * Add a vote to submission and recalculate timer
 */
export function addVote(
  submission: SocialAuthSubmission,
  userId: string,
  userName: string,
  voteType: VoteType
): { submission: SocialAuthSubmission; error?: string; instantResolution?: InstantResolution } {
  if (voteType === VoteType.APPROVE && userId === submission.submitterId && !submission.selfApprove) {
    return { submission, error: 'Submitter has not flagged this as self-approving; an additional approver must vote.' };
  }

  if (!submission.approverPool.memberIds.includes(userId) && userId !== submission.submitterId) {
    return { submission, error: 'Only @authnational members can vote on this request.' };
  }

  const hasApproveVote = submission.approveVotes.some(v => v.userId === userId);
  const hasObjectVote = submission.objectVotes.some(v => v.userId === userId);
  if (hasApproveVote || hasObjectVote) {
    return { submission, error: 'Cannot change vote after casting.' };
  }

  const vote: AuthPostVote = {
    id: submission.approveVotes.length + submission.objectVotes.length + 1,
    postId: submission.id,
    userId,
    userName,
    voteType,
    timestamp: new Date()
  };

  let updatedSubmission: SocialAuthSubmission = voteType === VoteType.APPROVE
    ? { ...submission, approveVotes: [...submission.approveVotes, vote] }
    : { ...submission, objectVotes: [...submission.objectVotes, vote] };

  const instantResolution = checkInstantResolution(
    submission.timerCalculation.gantryState,
    voteType,
    updatedSubmission.approveVotes,
    updatedSubmission.objectVotes,
    submission.approverPool.memberIds.length
  );

  updatedSubmission = updateSubmissionTimer(updatedSubmission);

  return { submission: updatedSubmission, instantResolution: instantResolution || undefined };
}

/**
 * Resolve effective sensitivity after AI risk assessment.
 * AI escalation is binding (requiredApprovals increases, publish behaviour tightens).
 * AI downgrade is advisory only — humans keep the higher standard the submitter set.
 */
export function resolveEffectiveSensitivity(
  submitterSensitivity: Sensitivity,
  aiSuggestedSensitivity: Sensitivity,
  verdict: 'agree' | 'escalate' | 'downgrade'
): Sensitivity {
  if (verdict === 'escalate') return aiSuggestedSensitivity;
  return submitterSensitivity;
}

/**
 * Determine publish behaviour based on effective sensitivity and vote history.
 * Returns the publish mode:
 *   auto        — publish immediately on approval (low risk, no objections)
 *   hold        — short hold window (15 min) with manual cancel option
 *   manual      — human must explicitly trigger publish
 */
export function resolvePublishMode(
  sensitivity: Sensitivity,
  hadObjections: boolean,
  wasSupermajority: boolean
): 'auto' | 'hold' | 'manual' {
  if (sensitivity === Sensitivity.HIGH) return 'manual';
  if (sensitivity === Sensitivity.MEDIUM) return wasSupermajority ? 'hold' : 'manual';
  // LOW sensitivity
  return hadObjections ? 'hold' : 'auto';
}

/**
 * Returns true when an APPROVED "hold" submission's auto-publish window has elapsed.
 * Driven by holdUntil (not the Fedica scheduledAt): a manual-publish post with no
 * holdUntil returns false and is never auto-fired by the timer service.
 */
export function isHoldPublishDue(holdUntil: Date | undefined): boolean {
  if (!holdUntil) return false;
  return holdUntil.getTime() <= Date.now();
}

/** Human-readable duration, e.g. "45m", "3h 20m", "2d 4h" — precision drops as the span grows. */
export function formatTimerDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/** One-line debug summary of a TimerCalculation — timer, approval/objection rates, gantry state. */
export function formatTimerCalculation(calc: TimerCalculation): string {
  return `Timer: ${formatTimerDuration(calc.clampedTimerMinutes)} | ` +
    `Approval: ${(calc.approvalRate * 100).toFixed(1)}% | ` +
    `Objection: ${(calc.objectionRate * 100).toFixed(1)}% | ` +
    `Modifier: ${calc.timerModifier.toFixed(2)}x | ` +
    `Gantry: ${calc.gantryState}`;
}
