/**
 * Comms Calendar module type definitions.
 * Replaces Chronicle Bot's comms-calendar function: displaying internationally recognised
 * days of significance coming up in the next week, in a standing #comms-cal embed.
 */

/** An annually-recurring day of significance. month is 1-12, day is 1-31 (local calendar). */
export interface SignificantDay {
  name: string;
  month: number;
  day: number;
  description?: string;
  sourceUrl?: string;
}

/** A SignificantDay resolved to its next occurring calendar date relative to "today". */
export interface UpcomingSignificantDay {
  day: SignificantDay;
  date: Date;
}
