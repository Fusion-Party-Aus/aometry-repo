/**
 * Events Calendar module type definitions.
 * Replaces Chronicle Bot's two-way Discord<->Google Calendar sync and the "Upcoming Event
 * Schedule" standing embed (Appendix A's "Detailed Event Summary Template").
 */

/** A single calendar event, normalised from either Discord scheduled events or Google Calendar. */
export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date | null;
  allDay: boolean;
  link: string | null;
  source: 'discord' | 'google';
}

/** Result of a Google Calendar push (Event Feed direction: Discord -> Google). */
export interface GoogleCalendarPushResult {
  success: boolean;
  googleEventId?: string;
  error?: string;
}
