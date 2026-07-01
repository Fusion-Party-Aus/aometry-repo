import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SocialAuthDatabaseManager } from './database';
import {
  SocialAuthSubmissionRequest,
  AuthPostStatus,
  VoteType,
  Sensitivity,
  PostContent,
  ApproverPool,
} from './types';

const CONTENT: PostContent = {
  commentary: 'Test post commentary',
  articleLink: 'https://example.com/article',
  policyLinks: ['https://www.fusionparty.org.au/climate_rescue'],
  hashtags: ['auspol', 'fusionparty'],
};

const POOL: ApproverPool = {
  name: 'authnational',
  memberIds: ['u1', 'u2', 'u3'],
};

function makeRequest(overrides: Partial<SocialAuthSubmissionRequest> = {}): SocialAuthSubmissionRequest {
  return {
    submitterId: 'submitter',
    submitterName: 'Submitter',
    destinations: ['Twitter/X', 'Facebook'],
    content: CONTENT,
    sensitivity: Sensitivity.MEDIUM,
    selfApprove: false,
    approverPool: POOL,
    channelId: 'ch-1',
    ...overrides,
  };
}

let db: SocialAuthDatabaseManager;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  db = new SocialAuthDatabaseManager(sqlite);
});

describe('generateAuthPostId', () => {
  it('first id is AUTH-YYYY-001', () => {
    const id = db.generateAuthPostId();
    const year = new Date().getFullYear();
    expect(id).toBe(`AUTH-${year}-001`);
  });

  it('increments sequentially', () => {
    const year = new Date().getFullYear();
    db.createSubmission(makeRequest(), 2, 240);
    db.createSubmission(makeRequest(), 2, 240);
    const id = db.generateAuthPostId();
    expect(id).toBe(`AUTH-${year}-003`);
  });
});

describe('createSubmission', () => {
  it('creates a submission with PENDING status', () => {
    const submission = db.createSubmission(makeRequest(), 2, 240);
    expect(submission.status).toBe(AuthPostStatus.PENDING);
    expect(submission.approveVotes).toHaveLength(0);
    expect(submission.objectVotes).toHaveLength(0);
  });

  it('persists and retrieves via getSubmission', () => {
    const created = db.createSubmission(makeRequest(), 2, 240);
    const fetched = db.getSubmission(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.content.commentary).toBe(CONTENT.commentary);
    expect(fetched!.destinations).toEqual(['Twitter/X', 'Facebook']);
    expect(fetched!.content.hashtags).toEqual(['auspol', 'fusionparty']);
  });

  it('sets expiresAt to initialTimerMinutes from now', () => {
    const before = Date.now();
    const submission = db.createSubmission(makeRequest(), 2, 120);
    const after = Date.now();
    const expiresMs = submission.expiresAt!.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 120 * 60000);
    expect(expiresMs).toBeLessThanOrEqual(after + 120 * 60000);
  });

  it('stores selfApprove flag correctly', () => {
    const sub = db.createSubmission(makeRequest({ selfApprove: true }), 1, 240);
    const fetched = db.getSubmission(sub.id);
    expect(fetched!.selfApprove).toBe(true);
  });
});

describe('getActiveSubmissions', () => {
  it('returns PENDING submissions', () => {
    db.createSubmission(makeRequest(), 2, 240);
    db.createSubmission(makeRequest(), 2, 240);
    expect(db.getActiveSubmissions()).toHaveLength(2);
  });

  it('excludes non-active statuses', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    const fetched = db.getSubmission(sub.id)!;
    fetched.status = AuthPostStatus.PUBLISHED;
    db.updateSubmission(fetched);
    expect(db.getActiveSubmissions()).toHaveLength(0);
  });
});

describe('addVote', () => {
  it('persists a vote and getVotes returns it', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    db.addVote({
      id: 0,
      postId: sub.id,
      userId: 'u1',
      userName: 'User1',
      voteType: VoteType.APPROVE,
      timestamp: new Date(),
    });
    const { approves, objects } = db.getVotes(sub.id);
    expect(approves).toHaveLength(1);
    expect(objects).toHaveLength(0);
    expect(approves[0].userId).toBe('u1');
    expect(approves[0].voteType).toBe(VoteType.APPROVE);
  });

  it('rejects duplicate vote from same user (UNIQUE constraint)', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    const vote = { id: 0, postId: sub.id, userId: 'u1', userName: 'User1', voteType: VoteType.APPROVE, timestamp: new Date() };
    db.addVote(vote);
    expect(() => db.addVote(vote)).toThrow();
  });
});

describe('addEdit', () => {
  it('stores edit record', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    db.addEdit(sub.id, {
      editedBy: 'u1',
      editedByName: 'User1',
      timestamp: new Date(),
      previousContent: CONTENT,
      newContent: { ...CONTENT, commentary: 'Updated commentary' },
    });
    const edits = db.getEdits(sub.id);
    expect(edits).toHaveLength(1);
    expect(edits[0].newContent.commentary).toBe('Updated commentary');
  });

  it('clears all votes when an edit is made', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    db.addVote({ id: 0, postId: sub.id, userId: 'u1', userName: 'User1', voteType: VoteType.APPROVE, timestamp: new Date() });
    db.addVote({ id: 0, postId: sub.id, userId: 'u2', userName: 'User2', voteType: VoteType.APPROVE, timestamp: new Date() });
    expect(db.getVotes(sub.id).approves).toHaveLength(2);

    db.addEdit(sub.id, {
      editedBy: 'submitter',
      editedByName: 'Submitter',
      timestamp: new Date(),
      previousContent: CONTENT,
      newContent: { ...CONTENT, commentary: 'Revised' },
    });

    const { approves, objects } = db.getVotes(sub.id);
    expect(approves).toHaveLength(0);
    expect(objects).toHaveLength(0);
  });
});

describe('getSubmission', () => {
  it('returns null for unknown id', () => {
    expect(db.getSubmission('AUTH-9999-999')).toBeNull();
  });

  it('round-trips policyLinks array', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    const fetched = db.getSubmission(sub.id)!;
    expect(fetched.content.policyLinks).toEqual(['https://www.fusionparty.org.au/climate_rescue']);
  });
});


describe('getSubmissionsInState', () => {
  it('returns only submissions with the requested status', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    // Newly created submissions are PENDING
    const pending = db.getSubmissionsInState(AuthPostStatus.PENDING);
    expect(pending.some(s => s.id === sub.id)).toBe(true);

    const approved = db.getSubmissionsInState(AuthPostStatus.APPROVED);
    expect(approved.some(s => s.id === sub.id)).toBe(false);
  });

  it('returns updated status after updateSubmission', () => {
    const sub = db.createSubmission(makeRequest(), 2, 240);
    db.updateSubmission({ ...sub, status: AuthPostStatus.APPROVED, resolvedAt: new Date() });

    const approved = db.getSubmissionsInState(AuthPostStatus.APPROVED);
    expect(approved.some(s => s.id === sub.id)).toBe(true);

    const pending = db.getSubmissionsInState(AuthPostStatus.PENDING);
    expect(pending.some(s => s.id === sub.id)).toBe(false);
  });

  it('returns empty array when no submissions match', () => {
    expect(db.getSubmissionsInState(AuthPostStatus.PUBLISHED)).toHaveLength(0);
  });
});
