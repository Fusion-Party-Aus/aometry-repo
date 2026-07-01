import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SocialAuthDatabaseManager } from './database';
import {
  SocialAuthSubmissionRequest,
  AuthPostVote,
  AuthPostStatus,
  GantryState,
  VoteType,
  Sensitivity,
  PostContent,
} from './types';

const CONTENT: PostContent = {
  commentary: 'Test post',
  articleLink: null,
  policyLinks: [],
  hashtags: [],
};

function makeRequest(overrides: Partial<SocialAuthSubmissionRequest> = {}): SocialAuthSubmissionRequest {
  return {
    submitterId: 'submitter',
    submitterName: 'Submitter',
    destinations: ['Twitter/X'],
    content: CONTENT,
    sensitivity: Sensitivity.MEDIUM,
    selfApprove: false,
    approverPool: { name: 'authnational', memberIds: ['u1', 'u2', 'u3', 'u4'] },
    channelId: 'ch-1',
    ...overrides,
  };
}

describe('SocialAuthDatabaseManager', () => {
  let db: SocialAuthDatabaseManager;

  beforeEach(() => {
    // Fresh in-memory database per test to avoid cross-test state leakage.
    db = new SocialAuthDatabaseManager(new Database(':memory:'));
  });

  describe('createSubmission / getSubmission — scheduledAt round trip', () => {
    it('persists and retrieves scheduledAt when provided', () => {
      const scheduledAt = new Date('2026-08-01T09:00:00Z');
      const created = db.createSubmission(makeRequest({ scheduledAt }), 2, 240);
      expect(created.scheduledAt).toEqual(scheduledAt);

      const fetched = db.getSubmission(created.id);
      expect(fetched?.scheduledAt).toEqual(scheduledAt);
    });

    it('leaves scheduledAt undefined when not provided', () => {
      const created = db.createSubmission(makeRequest(), 2, 240);
      expect(created.scheduledAt).toBeUndefined();

      const fetched = db.getSubmission(created.id);
      expect(fetched?.scheduledAt).toBeUndefined();
    });
  });

  describe('updateSubmission — fedicaScheduledAt persistence', () => {
    it('persists fedicaScheduledAt set by a Fedica publish result', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      const fedicaScheduledAt = new Date('2026-08-02T09:00:00Z');

      db.updateSubmission({
        ...created,
        status: AuthPostStatus.PUBLISHED,
        publishedAt: new Date(),
        fedicaPostId: 'fed-123',
        fedicaScheduledAt,
      });

      const fetched = db.getSubmission(created.id);
      expect(fetched?.status).toBe(AuthPostStatus.PUBLISHED);
      expect(fetched?.fedicaPostId).toBe('fed-123');
      expect(fetched?.fedicaScheduledAt).toEqual(fedicaScheduledAt);
    });

    it('persists null fedicaScheduledAt as undefined on read-back', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      db.updateSubmission({ ...created, status: AuthPostStatus.PUBLISH_FAILED, fedicaError: 'boom' });

      const fetched = db.getSubmission(created.id);
      expect(fetched?.fedicaScheduledAt).toBeUndefined();
      expect(fetched?.fedicaError).toBe('boom');
    });
  });

  describe('atomicVoteAndUpdate', () => {
    function makeVote(userId: string, voteType: VoteType, postId: string): AuthPostVote {
      return { id: 0, postId, userId, userName: userId, voteType, timestamp: new Date() };
    }

    it('records the vote, updates the submission, and writes the audit log entry together', () => {
      const created = db.createSubmission(makeRequest(), 2, 240);
      const vote = makeVote('u1', VoteType.APPROVE, created.id);
      const updatedSubmission = {
        ...created,
        approveVotes: [vote],
      };

      db.atomicVoteAndUpdate(vote, updatedSubmission, {
        postId: created.id,
        eventType: 'vote',
        actorId: 'u1',
        actorName: 'u1',
        timestamp: new Date(),
        details: { voteType: VoteType.APPROVE },
      });

      const { approves } = db.getVotes(created.id);
      expect(approves).toHaveLength(1);
      expect(approves[0].userId).toBe('u1');

      const fetched = db.getSubmission(created.id);
      expect(fetched?.approveVotes).toHaveLength(1);

      const auditLog = db.getAuditLog(created.id);
      expect(auditLog.some(entry => entry.eventType === 'vote')).toBe(true);
    });

    it('rolls back all writes if one part of the transaction fails', () => {
      const created = db.createSubmission(makeRequest(), 2, 240);
      const vote = makeVote('u1', VoteType.APPROVE, created.id);
      // Submitting the same vote twice violates the UNIQUE(post_id, user_id) constraint
      // on the second addVote call inside the transaction, which should roll back
      // the whole atomicVoteAndUpdate operation (including the audit log write).
      db.addVote(vote);

      expect(() =>
        db.atomicVoteAndUpdate(vote, { ...created, approveVotes: [vote] }, {
          postId: created.id,
          eventType: 'vote',
          timestamp: new Date(),
          details: {},
        })
      ).toThrow();

      // Audit log should NOT have the entry from the failed transaction.
      const auditLog = db.getAuditLog(created.id);
      expect(auditLog).toHaveLength(0);
    });
  });

  describe('atomicResolve', () => {
    it('applies the update and returns true when current status matches requiredCurrentStatus', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);

      const applied = db.atomicResolve(
        { ...created, status: AuthPostStatus.APPROVED, outcome: 'approved', outcomeReason: 'threshold met' },
        { postId: created.id, eventType: 'publish_attempt', timestamp: new Date(), details: {} }
      );

      expect(applied).toBe(true);
      const fetched = db.getSubmission(created.id);
      expect(fetched?.status).toBe(AuthPostStatus.APPROVED);
      expect(db.getAuditLog(created.id).some(e => e.eventType === 'publish_attempt')).toBe(true);
    });

    it('returns false and does not apply changes when current status does not match requiredCurrentStatus', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      // Move the submission to APPROVED out-of-band first.
      db.updateSubmission({ ...created, status: AuthPostStatus.APPROVED });

      // Simulate a second, concurrent interaction still expecting PENDING.
      const applied = db.atomicResolve(
        { ...created, status: AuthPostStatus.APPROVED, outcome: 'approved', outcomeReason: 'threshold met' },
        { postId: created.id, eventType: 'publish_attempt', timestamp: new Date(), details: {} },
        AuthPostStatus.PENDING
      );

      expect(applied).toBe(false);
      // No audit log entry should have been written for the rejected resolve.
      expect(db.getAuditLog(created.id).some(e => e.eventType === 'publish_attempt')).toBe(false);
    });

    it('returns false when the submission does not exist', () => {
      const nonExistent = db.createSubmission(makeRequest(), 1, 240);
      const applied = db.atomicResolve(
        { ...nonExistent, id: 'AUTH-9999-999', status: AuthPostStatus.APPROVED },
        { postId: 'AUTH-9999-999', eventType: 'publish_attempt', timestamp: new Date(), details: {} }
      );
      expect(applied).toBe(false);
    });

    it('supports guarding against re-resolving an already APPROVED submission (double-publish guard)', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      db.updateSubmission({ ...created, status: AuthPostStatus.APPROVED });

      const firstPublish = db.atomicResolve(
        { ...created, status: AuthPostStatus.PUBLISHED, publishedAt: new Date(), fedicaPostId: 'fed-1' },
        { postId: created.id, eventType: 'publish_success', timestamp: new Date(), details: {} },
        AuthPostStatus.APPROVED
      );
      expect(firstPublish).toBe(true);

      // A second concurrent publish attempt should be rejected since status is now PUBLISHED, not APPROVED.
      const secondPublish = db.atomicResolve(
        { ...created, status: AuthPostStatus.PUBLISHED, publishedAt: new Date(), fedicaPostId: 'fed-2' },
        { postId: created.id, eventType: 'publish_success', timestamp: new Date(), details: {} },
        AuthPostStatus.APPROVED
      );
      expect(secondPublish).toBe(false);

      const fetched = db.getSubmission(created.id);
      expect(fetched?.fedicaPostId).toBe('fed-1'); // Unchanged by the rejected second attempt.
    });
  });

  describe('hasNotifiedThreshold / setNotifiedThreshold', () => {
    it('returns false for a threshold that has not been notified yet', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      expect(db.hasNotifiedThreshold(created.id, 60)).toBe(false);
    });

    it('returns true after setNotifiedThreshold is called for that threshold', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      db.setNotifiedThreshold(created.id, 60);
      expect(db.hasNotifiedThreshold(created.id, 60)).toBe(true);
    });

    it('tracks thresholds independently per post and per threshold value', () => {
      const created1 = db.createSubmission(makeRequest(), 1, 240);
      const created2 = db.createSubmission(makeRequest(), 1, 240);

      db.setNotifiedThreshold(created1.id, 60);

      expect(db.hasNotifiedThreshold(created1.id, 60)).toBe(true);
      expect(db.hasNotifiedThreshold(created1.id, 240)).toBe(false);
      expect(db.hasNotifiedThreshold(created2.id, 60)).toBe(false);
    });

    it('is idempotent — calling setNotifiedThreshold twice does not throw (INSERT OR IGNORE)', () => {
      const created = db.createSubmission(makeRequest(), 1, 240);
      db.setNotifiedThreshold(created.id, 60);
      expect(() => db.setNotifiedThreshold(created.id, 60)).not.toThrow();
      expect(db.hasNotifiedThreshold(created.id, 60)).toBe(true);
    });
  });

  describe('schema migration for scheduled_at / fedica_scheduled_at columns', () => {
    it('does not throw when initializing against a database that already has the columns', () => {
      // Simulates re-running initializeTables (e.g. on process restart) against a DB
      // that has already been migrated — the ALTER TABLE calls should be no-ops.
      const rawDb = new Database(':memory:');
      expect(() => {
        new SocialAuthDatabaseManager(rawDb);
        new SocialAuthDatabaseManager(rawDb);
      }).not.toThrow();
    });
  });

  describe('rowToSubmission — basic field integrity (regression guard)', () => {
    it('round-trips a full submission including votes and gantry state', () => {
      const created = db.createSubmission(makeRequest({ notes: 'schedule: 2026-08-01T09:00' }), 2, 240);
      expect(created.timerCalculation.gantryState).toBe(GantryState.NONE);

      const vote = { id: 0, postId: created.id, userId: 'u1', userName: 'u1', voteType: VoteType.OBJECT, timestamp: new Date() };
      db.addVote(vote);

      const fetched = db.getSubmission(created.id);
      expect(fetched?.objectVotes).toHaveLength(1);
      expect(fetched?.notes).toBe('schedule: 2026-08-01T09:00');
      expect(fetched?.approverPool.memberIds).toEqual(['u1', 'u2', 'u3', 'u4']);
    });
  });
});