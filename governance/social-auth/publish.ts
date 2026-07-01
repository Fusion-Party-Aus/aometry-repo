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
 */

import { SocialAuthSubmission, FedicaPublishPayload, FedicaPublishResult, Destination } from './types';

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

// AEST = UTC+10. Australian summer (AEDT) uses UTC+11; accepted approximation here.
const AEST_OFFSET_MS = 10 * 3600 * 1000;

/**
 * Returns the next weekday at 09:00 AEST as a UTC Date.
 * Default schedule time when the submitter does not specify one.
 */
export function nextWeekdayAt9amAest(): Date {
  // Shift 'now' into AEST-coordinate space by adding the UTC+10 offset.
  const nowAsAest = Date.now() + AEST_OFFSET_MS;
  const d = new Date(nowAsAest);

  // Advance to tomorrow at 09:00 in AEST coordinates.
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(9, 0, 0, 0);

  // Skip Saturday (6) and Sunday (0).
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Convert back to real UTC.
  return new Date(d.getTime() - AEST_OFFSET_MS);
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
  const ms = Date.parse(`${raw}:00+10:00`);
  if (isNaN(ms)) return null;
  const d = new Date(ms);
  return d > new Date() ? d : null; // Discard past dates.
}

export function buildFedicaPayload(submission: SocialAuthSubmission): FedicaPublishPayload {
  const { content, destinations } = submission;

  let text = content.commentary;
  if (content.articleLink) text += `\n${content.articleLink}`;
  content.policyLinks.forEach(url => { text += `\nSee our policy here: ${url}`; });
  if (content.hashtags.length) text += `\n${content.hashtags.map(t => `#${t}`).join(' ')}`;

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
