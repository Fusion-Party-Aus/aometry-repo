/**
 * Events Calendar calculation engine — pure functions, no Discord.js/Google API.
 */

import { CalendarEvent } from './types';

/** Events starting within [now, now + windowDays], sorted soonest-first. */
export function getUpcomingEvents(events: CalendarEvent[], now: Date, windowDays: number): CalendarEvent[] {
  const windowEndMs = now.getTime() + windowDays * 86_400_000;
  return events
    .filter(e => e.startTime.getTime() >= now.getTime() && e.startTime.getTime() <= windowEndMs)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

/**
 * True when an event starts within `reminderMinutesBefore` minutes from now and hasn't
 * started yet. Callers should dedupe against already-reminded event IDs (see database.ts)
 * so the same event isn't re-announced on every timer tick while it's within the window.
 */
export function isEventReminderDue(event: CalendarEvent, now: Date, reminderMinutesBefore: number): boolean {
  const diffMs = event.startTime.getTime() - now.getTime();
  if (diffMs < 0) return false;
  return diffMs <= reminderMinutesBefore * 60_000;
}

function eventsDiffer(a: CalendarEvent, b: CalendarEvent): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.location !== b.location ||
    a.startTime.getTime() !== b.startTime.getTime() ||
    (a.endTime?.getTime() ?? null) !== (b.endTime?.getTime() ?? null) ||
    a.allDay !== b.allDay
  );
}

/**
 * Diff two event snapshots by ID: events present only in `currentEvents` are "created";
 * events present in both but with a different title/time/location/etc. are "changed".
 * Removed events (present in previous, absent from current) are not reported by this
 * function — the manual only asks for created/changed pings, not removal notices.
 */
export function detectEventChanges(
  previousEvents: CalendarEvent[],
  currentEvents: CalendarEvent[]
): { created: CalendarEvent[]; changed: CalendarEvent[] } {
  const previousById = new Map(previousEvents.map(e => [e.id, e]));
  const created: CalendarEvent[] = [];
  const changed: CalendarEvent[] = [];

  for (const event of currentEvents) {
    const prev = previousById.get(event.id);
    if (!prev) {
      created.push(event);
    } else if (eventsDiffer(prev, event)) {
      changed.push(event);
    }
  }

  return { created, changed };
}
