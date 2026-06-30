/**
 * Social Auth Database Manager
 * Handles all database operations for the #auth-socmed submit -> approve -> publish pipeline
 */

import Database from 'better-sqlite3';
import {
  SocialAuthSubmission,
  SocialAuthSubmissionRequest,
  AuthPostVote,
  AuthPostEdit,
  AuthPostAuditLog,
  AuthPostStatus,
  VoteType,
  PostContent,
  TimerCalculation
} from './types';
import { calculateDynamicTimer } from './calculator';

export class SocialAuthDatabaseManager {
  private db: Database.Database;

  private static instance: Database.Database | null = null;

  public static setGlobalDatabase(db: Database.Database): void {
    SocialAuthDatabaseManager.instance = db;
  }

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else if (SocialAuthDatabaseManager.instance) {
      this.db = SocialAuthDatabaseManager.instance;
    } else {
      this.db = new Database(':memory:');
    }
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_post_submissions (
        id TEXT PRIMARY KEY,
        submitter_id TEXT NOT NULL,
        submitter_name TEXT NOT NULL,

        destinations TEXT NOT NULL,
        content TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        notes TEXT,
        self_approve INTEGER NOT NULL DEFAULT 0,

        approver_pool_name TEXT NOT NULL,
        approver_pool_member_ids TEXT NOT NULL,

        initial_timer_minutes INTEGER NOT NULL,
        required_approvals INTEGER NOT NULL,

        status TEXT NOT NULL DEFAULT 'pending',
        submitted_at INTEGER NOT NULL,
        expires_at INTEGER,
        resolved_at INTEGER,
        published_at INTEGER,

        timer_calculation TEXT NOT NULL,

        outcome TEXT,
        outcome_reason TEXT,

        fedica_post_id TEXT,
        fedica_error TEXT,

        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,

        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_post_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        vote_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,

        FOREIGN KEY (post_id) REFERENCES auth_post_submissions(id),
        UNIQUE(post_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_auth_post_votes_post_id ON auth_post_votes(post_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_post_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        edited_by TEXT NOT NULL,
        edited_by_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        previous_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        reason TEXT,

        FOREIGN KEY (post_id) REFERENCES auth_post_submissions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_auth_post_edits_post_id ON auth_post_edits(post_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_post_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        timestamp INTEGER NOT NULL,
        details TEXT,
        previous_state TEXT,
        new_state TEXT,

        FOREIGN KEY (post_id) REFERENCES auth_post_submissions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_auth_post_audit_post_id ON auth_post_audit_log(post_id);
      CREATE INDEX IF NOT EXISTS idx_auth_post_audit_event_type ON auth_post_audit_log(event_type);
    `);
  }

  generateAuthPostId(): string {
    const year = new Date().getFullYear();
    const stmt = this.db.prepare(`
      SELECT id FROM auth_post_submissions WHERE id LIKE ? ORDER BY id DESC LIMIT 1
    `);
    const last = stmt.get(`AUTH-${year}-%`) as { id: string } | undefined;

    let nextNum = 1;
    if (last) {
      const match = last.id.match(/AUTH-\d{4}-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }

    return `AUTH-${year}-${String(nextNum).padStart(3, '0')}`;
  }

  createSubmission(request: SocialAuthSubmissionRequest, requiredApprovals: number, initialTimerMinutes: number): SocialAuthSubmission {
    const id = this.generateAuthPostId();
    const now = Date.now();

    const timerCalculation = calculateDynamicTimer(
      initialTimerMinutes,
      [],
      [],
      request.approverPool.memberIds.length
    );

    const submission: SocialAuthSubmission = {
      id,
      submitterId: request.submitterId,
      submitterName: request.submitterName,
      destinations: request.destinations,
      content: request.content,
      sensitivity: request.sensitivity,
      notes: request.notes,
      selfApprove: request.selfApprove,
      approverPool: request.approverPool,
      initialTimerMinutes,
      requiredApprovals,
      status: AuthPostStatus.PENDING,
      submittedAt: new Date(now),
      expiresAt: new Date(now + initialTimerMinutes * 60000),
      resolvedAt: null,
      publishedAt: null,
      approveVotes: [],
      objectVotes: [],
      edits: [],
      timerCalculation,
      channelId: request.channelId,
      messageId: ''
    };

    const stmt = this.db.prepare(`
      INSERT INTO auth_post_submissions (
        id, submitter_id, submitter_name,
        destinations, content, sensitivity, notes, self_approve,
        approver_pool_name, approver_pool_member_ids,
        initial_timer_minutes, required_approvals,
        status, submitted_at, expires_at,
        timer_calculation, channel_id, message_id
      ) VALUES (
        @id, @submitter_id, @submitter_name,
        @destinations, @content, @sensitivity, @notes, @self_approve,
        @approver_pool_name, @approver_pool_member_ids,
        @initial_timer_minutes, @required_approvals,
        @status, @submitted_at, @expires_at,
        @timer_calculation, @channel_id, @message_id
      )
    `);

    stmt.run({
      id: submission.id,
      submitter_id: submission.submitterId,
      submitter_name: submission.submitterName,
      destinations: JSON.stringify(submission.destinations),
      content: JSON.stringify(submission.content),
      sensitivity: submission.sensitivity,
      notes: submission.notes || null,
      self_approve: submission.selfApprove ? 1 : 0,
      approver_pool_name: submission.approverPool.name,
      approver_pool_member_ids: JSON.stringify(submission.approverPool.memberIds),
      initial_timer_minutes: submission.initialTimerMinutes,
      required_approvals: submission.requiredApprovals,
      status: submission.status,
      submitted_at: submission.submittedAt.getTime(),
      expires_at: submission.expiresAt?.getTime() || null,
      timer_calculation: JSON.stringify(submission.timerCalculation),
      channel_id: submission.channelId,
      message_id: submission.messageId
    });

    this.addAuditLog({
      postId: submission.id,
      eventType: 'submission',
      actorId: submission.submitterId,
      actorName: submission.submitterName,
      timestamp: new Date(),
      details: {
        sensitivity: submission.sensitivity,
        requiredApprovals: submission.requiredApprovals,
        destinations: submission.destinations
      },
      previousState: null,
      newState: submission
    });

    return submission;
  }

  getSubmission(id: string): SocialAuthSubmission | null {
    const stmt = this.db.prepare('SELECT * FROM auth_post_submissions WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToSubmission(row);
  }

  getActiveSubmissions(): SocialAuthSubmission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_post_submissions
      WHERE status IN ('pending', 'in_edit')
      ORDER BY submitted_at DESC
    `);
    return (stmt.all() as any[]).map(row => this.rowToSubmission(row));
  }

  updateSubmission(submission: SocialAuthSubmission): void {
    const stmt = this.db.prepare(`
      UPDATE auth_post_submissions SET
        content = @content,
        status = @status,
        expires_at = @expires_at,
        resolved_at = @resolved_at,
        published_at = @published_at,
        timer_calculation = @timer_calculation,
        outcome = @outcome,
        outcome_reason = @outcome_reason,
        fedica_post_id = @fedica_post_id,
        fedica_error = @fedica_error,
        message_id = @message_id,
        thread_id = @thread_id,
        updated_at = @updated_at
      WHERE id = @id
    `);

    stmt.run({
      id: submission.id,
      content: JSON.stringify(submission.content),
      status: submission.status,
      expires_at: submission.expiresAt?.getTime() || null,
      resolved_at: submission.resolvedAt?.getTime() || null,
      published_at: submission.publishedAt?.getTime() || null,
      timer_calculation: JSON.stringify(submission.timerCalculation),
      outcome: submission.outcome || null,
      outcome_reason: submission.outcomeReason || null,
      fedica_post_id: submission.fedicaPostId || null,
      fedica_error: submission.fedicaError || null,
      message_id: submission.messageId,
      thread_id: submission.threadId || null,
      updated_at: Date.now()
    });
  }

  addVote(vote: AuthPostVote): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_post_votes (post_id, user_id, user_name, vote_type, timestamp)
      VALUES (@post_id, @user_id, @user_name, @vote_type, @timestamp)
    `);

    stmt.run({
      post_id: vote.postId,
      user_id: vote.userId,
      user_name: vote.userName,
      vote_type: vote.voteType,
      timestamp: vote.timestamp.getTime()
    });
  }

  getVotes(postId: string): { approves: AuthPostVote[]; objects: AuthPostVote[] } {
    const stmt = this.db.prepare('SELECT * FROM auth_post_votes WHERE post_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(postId) as any[];

    const approves: AuthPostVote[] = [];
    const objects: AuthPostVote[] = [];

    for (const row of rows) {
      const vote: AuthPostVote = {
        id: row.id,
        postId: row.post_id,
        userId: row.user_id,
        userName: row.user_name,
        voteType: row.vote_type as VoteType,
        timestamp: new Date(row.timestamp)
      };
      (vote.voteType === VoteType.APPROVE ? approves : objects).push(vote);
    }

    return { approves, objects };
  }

  /**
   * Record a content edit and reset votes, since the approved/objected text no longer
   * matches what was voted on. Returns the cleared submission ready for re-approval.
   */
  addEdit(postId: string, edit: Omit<AuthPostEdit, 'id' | 'postId'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_post_edits (post_id, edited_by, edited_by_name, timestamp, previous_content, new_content, reason)
      VALUES (@post_id, @edited_by, @edited_by_name, @timestamp, @previous_content, @new_content, @reason)
    `);

    stmt.run({
      post_id: postId,
      edited_by: edit.editedBy,
      edited_by_name: edit.editedByName,
      timestamp: edit.timestamp.getTime(),
      previous_content: JSON.stringify(edit.previousContent),
      new_content: JSON.stringify(edit.newContent),
      reason: edit.reason || null
    });

    this.db.prepare('DELETE FROM auth_post_votes WHERE post_id = ?').run(postId);
  }

  getEdits(postId: string): AuthPostEdit[] {
    const stmt = this.db.prepare('SELECT * FROM auth_post_edits WHERE post_id = ? ORDER BY timestamp ASC');
    return (stmt.all(postId) as any[]).map(row => ({
      id: row.id,
      postId: row.post_id,
      editedBy: row.edited_by,
      editedByName: row.edited_by_name,
      timestamp: new Date(row.timestamp),
      previousContent: JSON.parse(row.previous_content) as PostContent,
      newContent: JSON.parse(row.new_content) as PostContent,
      reason: row.reason || undefined
    }));
  }

  addAuditLog(log: Omit<AuthPostAuditLog, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_post_audit_log (
        post_id, event_type, actor_id, actor_name, timestamp, details, previous_state, new_state
      ) VALUES (
        @post_id, @event_type, @actor_id, @actor_name, @timestamp, @details, @previous_state, @new_state
      )
    `);

    stmt.run({
      post_id: log.postId,
      event_type: log.eventType,
      actor_id: log.actorId || null,
      actor_name: log.actorName || null,
      timestamp: log.timestamp.getTime(),
      details: JSON.stringify(log.details),
      previous_state: log.previousState ? JSON.stringify(log.previousState) : null,
      new_state: log.newState ? JSON.stringify(log.newState) : null
    });
  }

  getAuditLog(postId: string): AuthPostAuditLog[] {
    const stmt = this.db.prepare('SELECT * FROM auth_post_audit_log WHERE post_id = ? ORDER BY timestamp ASC');
    return (stmt.all(postId) as any[]).map(row => ({
      id: row.id,
      postId: row.post_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      actorName: row.actor_name,
      timestamp: new Date(row.timestamp),
      details: JSON.parse(row.details),
      previousState: row.previous_state ? JSON.parse(row.previous_state) : undefined,
      newState: row.new_state ? JSON.parse(row.new_state) : undefined
    }));
  }

  private rowToSubmission(row: any): SocialAuthSubmission {
    const { approves, objects } = this.getVotes(row.id);
    const edits = this.getEdits(row.id);

    return {
      id: row.id,
      submitterId: row.submitter_id,
      submitterName: row.submitter_name,
      destinations: JSON.parse(row.destinations),
      content: JSON.parse(row.content) as PostContent,
      sensitivity: row.sensitivity,
      notes: row.notes || undefined,
      selfApprove: !!row.self_approve,
      approverPool: {
        name: row.approver_pool_name,
        memberIds: JSON.parse(row.approver_pool_member_ids)
      },
      initialTimerMinutes: row.initial_timer_minutes,
      requiredApprovals: row.required_approvals,
      status: row.status as AuthPostStatus,
      submittedAt: new Date(row.submitted_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      approveVotes: approves,
      objectVotes: objects,
      edits,
      timerCalculation: JSON.parse(row.timer_calculation) as TimerCalculation,
      outcome: row.outcome,
      outcomeReason: row.outcome_reason,
      fedicaPostId: row.fedica_post_id || undefined,
      fedicaError: row.fedica_error || undefined,
      channelId: row.channel_id,
      messageId: row.message_id,
      threadId: row.thread_id
    };
  }
}
