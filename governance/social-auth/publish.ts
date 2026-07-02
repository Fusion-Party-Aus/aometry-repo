/**
 * Fedica Publish Integration
 *
 * Provides an automated draft-to-schedule pathway: once a submission reaches its
 * approval threshold, `publishToFedica` is called to schedule the post on Fedica.
 *
 * Configuration (set these environment variables on the host bot):
 *   FEDICA_API_KEY  — Bearer token for the Fedica API (required for live calls)
 *   FEDICA_API_URL  — Override base URL (default: https://api.fedica.com/api)
 *
 * Stub mode: if FEDICA_API_KEY is not set, the function logs the payload and
 * returns a stub result so the rest of the pipeline works in development.
 *
 * TODO(fedica-integration): confirm real endpoint + request shape once credentials/docs arrive.
 */

import { SocialAuthSubmission, FedicaPublishPayload, FedicaPublishResult, Destination, PostContent } from './types';

const FEDICA_API_URL = process.env.FEDICA_API_URL ?? 'https://api.fedica.com/api';
const FEDICA_API_KEY = process.env.FEDICA_API_KEY ?? '';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// Maps Destination values → Fedica platform identifiers.
// Newsletter and Other have no direct Fedica mapping and are filtered before the API call.
const PLATFORM_MAP: Partial<Record<Destination, string>> = {
  'Facebook':   'facebook',
  'Twitter/X':  'twitter',
  'Instagram':  'instagram',
  'Mastodon':   'mastodon',
  'LinkedIn':   'linkedin',
};

const SYDNEY_TZ = 'Australia/Sydney';

const SYDNEY_WALL_FMT = new Intl.DateTimeFormat('en-AU', {
  timeZone: SYDNEY_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** Decompose a UTC timestamp into its Sydney wall-clock parts (handles AEST/AEDT). */
function sydneyWallParts(utcMs: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = SYDNEY_WALL_FMT.formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour') % 24, minute: get('minute'), second: get('second'),
  };
}

/** Return the Sydney UTC offset in milliseconds at a given UTC timestamp (handles AEST/AEDT). */
function sydneyOffsetMs(utcMs: number): number {
  const w = sydneyWallParts(utcMs);
  const sydneyWall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return sydneyWall - utcMs;
}

/**
 * Returns the next weekday at 09:00 Sydney time (AEST or AEDT) as a UTC Date.
 * Default schedule time when the submitter does not specify one.
 */
export function nextWeekdayAt9amAest(): Date {
  const weekdayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: SYDNEY_TZ, weekday: 'short' });
  const dateFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: SYDNEY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const trialUtc = Date.now() + daysAhead * 86400000;
    const offsetMs = sydneyOffsetMs(trialUtc);

    const parts = dateFmt.formatToParts(new Date(trialUtc));
    const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10);

    // Compute 09:00 Sydney wall-clock on this calendar day as UTC.
    const nineAmUtc = Date.UTC(get('year'), get('month') - 1, get('day'), 9, 0, 0) - offsetMs;

    const dayName = weekdayFmt.format(new Date(nineAmUtc));
    if (dayName !== 'Sat' && dayName !== 'Sun') {
      return new Date(nineAmUtc);
    }
  }

  // Unreachable: 7-day window always contains a weekday.
  throw new Error('Could not find a weekday in the next 7 days');
}

/**
 * Parse a schedule datetime from free-form text.
 * Accepts "schedule: YYYY-MM-DDTHH:MM" or "schedule: YYYY-MM-DD HH:MM" (treated as AEST).
 * Returns null if no valid future datetime is found.
 */
export function parseScheduleFromText(text: string): Date | null {
  const match = text.match(/\bschedule:\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/i);
  if (!match) return null;
  const raw = match[1].replace(' ', 'T');

  // Parse the datetime as a naive local time, then determine the correct Sydney offset
  // for that instant (handles both AEST UTC+10 and AEDT UTC+11).
  // First pass: estimate UTC using UTC+10 to get a rough Sydney date, then re-derive offset.
  const roughMs = Date.parse(`${raw}:00+10:00`);
  if (isNaN(roughMs)) return null;
  const offsetMs = sydneyOffsetMs(roughMs);
  // Second pass: apply the correct offset for that date.
  const [datePart, timePart] = raw.split('T');
  const [y, mo, dy] = datePart.split('-').map(Number);
  const [hr, mn] = timePart.split(':').map(Number);
  const ms = Date.UTC(y, mo - 1, dy, hr, mn, 0) - offsetMs;
  if (isNaN(ms)) return null;
  const d = new Date(ms);

  // Round-trip validation: reject impossible calendar dates (e.g. month 13, 30 Feb)
  // and non-existent local times inside a DST spring-forward gap. Both would otherwise
  // be silently normalised by Date.UTC into a different instant than the operator typed.
  const w = sydneyWallParts(ms);
  if (w.year !== y || w.month !== mo || w.day !== dy || w.hour !== hr || w.minute !== mn) {
    return null;
  }

  return d > new Date() ? d : null; // Discard past dates.
}

const TWITTER_CHAR_LIMIT = 280;
const IMAGE_DESTINATIONS: Destination[] = ['Facebook', 'Instagram'];

// Twitter/X wraps every link in a fixed-length t.co URL, so a URL always weighs 23
// characters toward the limit regardless of its real length.
const TWITTER_URL_WEIGHT = 23;
const URL_PATTERN = /https?:\/\/[^\s]+/g;

/**
 * Weighted character length as counted by Twitter/X:
 *  - each URL counts as 23 characters (t.co wrapping), not its literal length
 *  - the remaining text is counted by Unicode code points, so surrogate-pair
 *    emoji are not double-counted as two UTF-16 units
 * This is an approximation of twitter-text weighting (it does not apply the CJK
 * double-weight), but it removes the biggest source of false positives: long URLs.
 */
export function weightedTweetLength(text: string): number {
  const urls = text.match(URL_PATTERN) ?? [];
  const withoutUrls = text.replace(URL_PATTERN, '');
  const textPoints = [...withoutUrls].length;
  return textPoints + urls.length * TWITTER_URL_WEIGHT;
}

// Re-exported for existing callers (interaction.ts, this file's own validators/payload
// builder) — the canonical implementation lives in content.ts, a lower-level module with
// no Fedica dependency, so llm-pipeline.ts can use it without importing this publish layer.
export { composePostText } from './content';
import { composePostText } from './content';

/** A destination-constraint finding from validatePostForDestinations. 'error' blocks submission; 'warning' is advisory. */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Validate post content against destination-specific constraints.
 * Returns structured issues: severity='error' blocks submission; severity='warning' is advisory.
 */
export function validatePostForDestinations(content: PostContent, destinations: Destination[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = composePostText(content);

  if (destinations.includes('Twitter/X')) {
    const weighted = weightedTweetLength(text);
    if (weighted > TWITTER_CHAR_LIMIT) {
      issues.push({ severity: 'error', message: `Twitter/X limit is ${TWITTER_CHAR_LIMIT} characters — composed post is ${weighted} chars (links count as ${TWITTER_URL_WEIGHT}). Shorten the commentary or hashtags.` });
    }
  }

  if (destinations.some(d => IMAGE_DESTINATIONS.includes(d))) {
    const imageTargets = destinations.filter(d => IMAGE_DESTINATIONS.includes(d)).join(' and ');
    issues.push({ severity: 'warning', message: `${imageTargets} selected — you will need to attach an image manually in Fedica before publishing.` });
  }

  return issues;
}

/** Build the Fedica API payload from a submission, resolving scheduledAt to the default when unset. */
export function buildFedicaPayload(submission: SocialAuthSubmission): FedicaPublishPayload {
  const { content, destinations } = submission;

  const text = composePostText(content);
  const imageRequired = destinations.includes('Facebook') || destinations.includes('Instagram');
  const scheduledAt = submission.scheduledAt ?? nextWeekdayAt9amAest();

  return {
    postId: submission.id,
    destinations,
    text,
    articleLink: content.articleLink,
    imageRequired,
    scheduledAt,
  };
}

interface FedicaApiResponse {
  id: string | number;
  scheduled_at?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callFedicaApi(body: Record<string, unknown>, attempt = 0): Promise<FedicaApiResponse> {
  const res = await fetch(`${FEDICA_API_URL}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FEDICA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => String(res.status));
    // Retry on transient 5xx errors with exponential backoff.
    if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
      return callFedicaApi(body, attempt + 1);
    }
    throw new Error(`Fedica API ${res.status}: ${errText.substring(0, 300)}`);
  }

  return res.json() as Promise<FedicaApiResponse>;
}

/**
 * Schedule an approved submission on Fedica (draft → scheduled post).
 *
 * Stub mode (FEDICA_API_KEY not set): logs payload, returns synthetic success.
 * Live mode: POSTs to Fedica API, retrying up to 3× on transient server errors.
 *
 * Schedule time resolution order:
 *   1. submission.scheduledAt  (parsed from "schedule: ..." in submitter's notes)
 *   2. nextWeekdayAt9amAest()  (automatic default)
 */
export async function publishToFedica(submission: SocialAuthSubmission): Promise<FedicaPublishResult> {
  const payload = buildFedicaPayload(submission);

  if (!FEDICA_API_KEY) {
    console.log(
      `[Fedica Stub] ${payload.postId} → [${payload.destinations.join(', ')}]` +
      ` scheduled ${payload.scheduledAt.toISOString()}:\n${payload.text}`
    );
    return {
      success: true,
      fedicaPostId: `stub-${payload.postId}`,
      fedicaScheduledAt: payload.scheduledAt,
    };
  }

  try {
    const platforms = payload.destinations
      .map(d => PLATFORM_MAP[d])
      .filter((p): p is string => p !== undefined);

    if (platforms.length === 0) {
      return {
        success: false,
        error: `No Fedica-mapped platforms for: ${payload.destinations.join(', ')} (Newsletter/Other require manual posting)`,
      };
    }

    const body: Record<string, unknown> = {
      text: payload.text,
      platforms,
      scheduled_at: payload.scheduledAt.toISOString(),
    };
    if (payload.articleLink) body.link = payload.articleLink;

    const result = await callFedicaApi(body);
    const confirmedAt = result.scheduled_at ? new Date(result.scheduled_at) : payload.scheduledAt;

    return {
      success: true,
      fedicaPostId: String(result.id),
      fedicaScheduledAt: confirmedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
