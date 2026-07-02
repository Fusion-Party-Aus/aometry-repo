/**
 * Google Calendar integration — the "Fusion Public & Member Events" calendar sync.
 *
 * Configuration (environment variables on the host bot):
 *   GOOGLE_CALENDAR_ID       — the calendar to sync (required for live calls)
 *   GOOGLE_CALENDAR_API_KEY  — read-only API key, sufficient for fetchGoogleCalendarEvents()
 *
 * Stub mode: if GOOGLE_CALENDAR_API_KEY is not set, fetchGoogleCalendarEvents() returns []
 * and pushEventToGoogleCalendar() logs and returns a synthetic success, same pattern as
 * social-auth/publish.ts's Fedica stub.
 *
 * TODO(google-calendar-integration): pushEventToGoogleCalendar() (the Event Feed direction,
 * Discord -> Google) needs write access, which the Calendar API only grants via OAuth or a
 * service account — a plain API key (used here for the read-only fetch) cannot write events.
 * Confirm the real auth approach and request shape once credentials are available; this
 * function's stub-mode contract (return shape) is final, only the live-mode body needs it.
 */

import { CalendarEvent, GoogleCalendarPushResult } from './types';

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? '';
const GOOGLE_CALENDAR_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY ?? '';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleCalendarApiEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

function parseApiEvent(apiEvent: GoogleCalendarApiEvent): CalendarEvent {
  const allDay = !!apiEvent.start.date && !apiEvent.start.dateTime;
  return {
    id: apiEvent.id,
    title: apiEvent.summary ?? '(untitled event)',
    description: apiEvent.description ?? null,
    location: apiEvent.location ?? null,
    startTime: new Date(apiEvent.start.dateTime ?? apiEvent.start.date ?? Date.now()),
    endTime: apiEvent.end.dateTime || apiEvent.end.date ? new Date(apiEvent.end.dateTime ?? apiEvent.end.date!) : null,
    allDay,
    link: apiEvent.htmlLink ?? null,
    source: 'google',
  };
}

/** Fetch events from the configured Google Calendar. Stub mode returns []. */
export async function fetchGoogleCalendarEvents(): Promise<CalendarEvent[]> {
  if (!GOOGLE_CALENDAR_API_KEY || !GOOGLE_CALENDAR_ID) {
    console.log('[Events Calendar Stub] fetchGoogleCalendarEvents() — no credentials configured, returning empty list.');
    return [];
  }

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?key=${GOOGLE_CALENDAR_API_KEY}&singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[Events Calendar] Google Calendar fetch failed: ${res.status}`);
    return [];
  }
  const body = (await res.json()) as { items?: GoogleCalendarApiEvent[] };
  return (body.items ?? []).map(parseApiEvent);
}

/**
 * Push a Discord-created event to Google Calendar (Event Feed direction).
 * Stub mode: logs the payload, returns a synthetic success so the rest of the pipeline
 * works in development. Live mode needs write credentials — see TODO above.
 */
export async function pushEventToGoogleCalendar(event: CalendarEvent): Promise<GoogleCalendarPushResult> {
  if (!GOOGLE_CALENDAR_API_KEY || !GOOGLE_CALENDAR_ID) {
    console.log(`[Events Calendar Stub] pushEventToGoogleCalendar() — would push "${event.title}" at ${event.startTime.toISOString()}`);
    return { success: true, googleEventId: `stub-${event.id}` };
  }

  return {
    success: false,
    error: 'Live push not implemented — GOOGLE_CALENDAR_API_KEY grants read access only; write requires OAuth/service account (see TODO in this file).',
  };
}
