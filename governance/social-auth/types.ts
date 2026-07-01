/**
 * Social Auth Pipeline Type Definitions
 * Drives the #auth-socmed workflow: submit -> comment -> approve -> edit -> publish (Fedica)
 *
 * Approval mechanics reuse the same dynamic timer/gantry model as governance/ncap,
 * parameterised by sensitivity tier instead of NCAP category.
 */

/**
 * Lifecycle status of a social auth submission
 */
export enum AuthPostStatus {
  PENDING = 'pending',           // Active, awaiting votes/timer expiration
  IN_EDIT = 'in_edit',           // Sent back for edits, paused pending resubmission
  APPROVED = 'approved',         // Threshold met - queued for Fedica publish
  PUBLISHED = 'published',       // Successfully pushed to Fedica
  PUBLISH_FAILED = 'publish_failed', // Fedica publish attempt failed
  BLOCKED = 'blocked',           // Blocked via objection gantry expiration or instant dismissal
  WITHDRAWN = 'withdrawn'        // Withdrawn by submitter before completion
}

/**
 * Gantry state, mirrors governance/ncap GantryState
 */
export enum GantryState {
  NONE = 'none',
  NATURAL_APPROVAL = 'natural_approval',
  VOTED_APPROVAL = 'voted_approval',
  OBJECTION = 'objection'
}

/**
 * Vote type cast by an approver pool member
 */
export enum VoteType {
  APPROVE = 'approve',
  OBJECT = 'object'
}

/**
 * Sensitivity tier, mirrors the "Content type" field in the manual Auth Request Builder
 */
export enum Sensitivity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

/**
 * Approver pool config per sensitivity tier (default required approvals + eligible role)
 */
export interface SensitivityConfig {
  label: string;
  requiredApprovals: number;
  allowSelfApprove: boolean;
  initialTimerMinutes: number;
}

export const SENSITIVITY_CONFIG: Record<Sensitivity, SensitivityConfig> = {
  [Sensitivity.LOW]: { label: 'Low', requiredApprovals: 1, allowSelfApprove: true, initialTimerMinutes: 240 },
  [Sensitivity.MEDIUM]: { label: 'Medium', requiredApprovals: 2, allowSelfApprove: false, initialTimerMinutes: 240 },
  [Sensitivity.HIGH]: { label: 'High', requiredApprovals: 2, allowSelfApprove: false, initialTimerMinutes: 240 }
};

/**
 * Social media / publish destination, matches the manual tool's destination chips
 */
export type Destination =
  | 'Facebook' | 'Twitter/X' | 'Instagram' | 'Mastodon' | 'LinkedIn' | 'Newsletter' | 'Other';

export const DESTINATIONS: Destination[] = [
  'Facebook', 'Twitter/X', 'Instagram', 'Mastodon', 'LinkedIn', 'Newsletter', 'Other'
];

/** Policy tag → URL map, mirrors TAGS_POLICY in auth-request-builder.html */
export const POLICY_TAGS: { tag: string; url: string }[] = [
  { tag: 'ClimateRescue',        url: 'https://www.fusionparty.org.au/climate_rescue' },
  { tag: 'FutureFocused',        url: 'https://www.fusionparty.org.au/future_focused' },
  { tag: 'EducationForLife',     url: 'https://www.fusionparty.org.au/education_for_life' },
  { tag: 'EthicalGovernance',    url: 'https://www.fusionparty.org.au/ethical_governance' },
  { tag: 'DrugReform',           url: 'https://www.fusionparty.org.au/policy_faq' },
  { tag: 'FairSociety',          url: 'https://www.fusionparty.org.au/fair_inclusive_society' },
  { tag: 'IndividualFreedoms',   url: 'https://www.fusionparty.org.au/individual_freedoms' },
  { tag: 'UBI',                  url: 'https://www.fusionparty.org.au/fair_inclusive_society' },
  { tag: 'EcologicalRestoration',url: 'https://www.fusionparty.org.au/ecological_restoration' },
  { tag: 'DigitalLiberty',       url: 'https://www.fusionparty.org.au/civil_digital_liberties' },
  { tag: 'SecularHumanism',      url: 'https://www.fusionparty.org.au/secular_humanism' },
  { tag: 'FairForeignPolicy',    url: 'https://www.fusionparty.org.au/fair_foreign_policy' },
  { tag: 'HousingAsAHome',       url: 'https://www.fusionparty.org.au/housing_as_a_home' },
  { tag: 'AntiAgeing',           url: 'https://www.fusionparty.org.au/future_focused' },
];

/** Core hashtags always pre-selected, mirrors TAGS_CORE */
export const HASHTAGS_CORE = ['auspol', 'fusionparty'];

/** Branch/partner hashtags, mirrors TAGS_BRANCH */
export const HASHTAGS_BRANCH = [
  'ScienceParty', 'PirateParty', 'SecularParty',
  'VotePlanet', 'ClimateJustice', 'AusProgressives', 'DemocracyFirst'
];

/**
 * Approver pool: who is allowed to vote (typically @authnational)
 */
export interface ApproverPool {
  name: string;
  memberIds: string[];       // Discord user IDs eligible to approve/object
}

/**
 * Individual vote record
 */
export interface AuthPostVote {
  id: number;
  postId: string;
  userId: string;
  userName: string;
  voteType: VoteType;
  timestamp: Date;
}

/**
 * Dynamic timer/gantry calculation, structurally identical to governance/ncap's TimerCalculation
 */
export interface TimerCalculation {
  initialTimerMinutes: number;
  approvalRate: number;
  objectionRate: number;
  timerModifier: number;
  currentTimerMinutes: number;
  floor: number;
  ceiling: number;
  clampedTimerMinutes: number;
  gantryState: GantryState;
  gantryExpiresAt: Date | null;
}

/**
 * Post content - the part that goes to Fedica
 */
export interface PostContent {
  commentary: string;
  articleLink: string | null;
  policyLinks: string[];
  hashtags: string[];
}

/**
 * Edit history entry - records each revision of post content
 */
export interface AuthPostEdit {
  id: number;
  postId: string;
  editedBy: string;
  editedByName: string;
  timestamp: Date;
  previousContent: PostContent;
  newContent: PostContent;
  reason?: string;
}

/**
 * Full social auth submission record
 */
export interface SocialAuthSubmission {
  id: string;                        // e.g. "AUTH-2026-001"

  submitterId: string;
  submitterName: string;

  destinations: Destination[];
  content: PostContent;
  sensitivity: Sensitivity;
  notes?: string;
  selfApprove: boolean;

  approverPool: ApproverPool;
  initialTimerMinutes: number;
  requiredApprovals: number;

  status: AuthPostStatus;
  submittedAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  publishedAt: Date | null;

  approveVotes: AuthPostVote[];
  objectVotes: AuthPostVote[];
  edits: AuthPostEdit[];

  timerCalculation: TimerCalculation;

  outcome?: 'approved' | 'blocked' | 'withdrawn';
  outcomeReason?: string;

  fedicaPostId?: string;
  fedicaError?: string;
  scheduledAt?: Date;         // Intended Fedica post time (defaults to next weekday 9am AEST)
  fedicaScheduledAt?: Date;   // Confirmed schedule time returned by Fedica API

  // Discord integration
  channelId: string;
  messageId: string;
  threadId?: string;
}

/**
 * Data needed to create a new social auth submission
 */
export interface SocialAuthSubmissionRequest {
  submitterId: string;
  submitterName: string;
  destinations: Destination[];
  content: PostContent;
  sensitivity: Sensitivity;
  notes?: string;
  selfApprove: boolean;
  scheduledAt?: Date;    // Parsed from notes; falls back to next weekday 9am AEST at publish time
  approverPool: ApproverPool;
  channelId: string;
}

/**
 * Audit log entry
 */
export interface AuthPostAuditLog {
  id: number;
  postId: string;
  eventType: 'submission' | 'vote' | 'edit' | 'timer_update' | 'gantry_entry' |
             'instant_resolution' | 'expiration' | 'publish_attempt' | 'publish_success' |
             'publish_failure' | 'withdrawal';
  actorId?: string;
  actorName?: string;
  timestamp: Date;
  details: Record<string, any>;
  previousState?: any;
  newState?: any;
}

/**
 * Instant resolution trigger, mirrors governance/ncap's InstantResolution
 */
export interface InstantResolution {
  type: 'supermajority_bypass' | 'approval_gantry_approve' | 'objection_gantry_object';
  triggeredAt: Date;
  triggeredBy: string;
  finalVoteCount: {
    approves: number;
    objects: number;
    poolSize: number;
  };
}

/**
 * Timer/threshold constants, mirrors governance/ncap TIMER_CONSTANTS
 */
export const TIMER_CONSTANTS = {
  APPROVAL_COEFFICIENT: 0.5,
  OBJECTION_COEFFICIENT: 1.0,
  FLOOR_MULTIPLIER: 0.5,
  CEILING_MULTIPLIER: 2.0,
  NATURAL_GANTRY_THRESHOLD: 0.25,
  SUPERMAJORITY_THRESHOLD: 0.75,
  UPDATE_INTERVAL_MS: 60 * 1000,
  REMINDER_THRESHOLDS: [60, 240]
};

/**
 * Data needed to create a new social auth submission (schedule time optional; defaults to next weekday 9am AEST)
 */

/**
 * Fedica publish payload - what gets handed to the Fedica integration
 */
export interface FedicaPublishPayload {
  postId: string;
  destinations: Destination[];
  text: string;            // Final composed post text (commentary + links + hashtags)
  articleLink: string | null;
  imageRequired: boolean;  // True if Facebook/Instagram are included (manual screenshot attach)
  scheduledAt: Date;       // When to publish on Fedica (never undefined - always resolved before API call)
}

/**
 * Result of a Fedica publish attempt
 */
export interface FedicaPublishResult {
  success: boolean;
  fedicaPostId?: string;
  fedicaScheduledAt?: Date; // Confirmed schedule time from Fedica response
  error?: string;
}
