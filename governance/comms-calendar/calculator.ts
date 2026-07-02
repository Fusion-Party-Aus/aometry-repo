/**
 * Comms Calendar calculation engine — pure functions, no Discord.js.
 */

import { SignificantDay, UpcomingSignificantDay } from './types';

/**
 * Resolve each configured day to its next occurrence on/after `today` (UTC calendar dates,
 * rolling to next year if this year's occurrence has passed), and return those falling
 * within `windowDays` days from today (inclusive on both ends), sorted soonest-first.
 */
export function getUpcomingSignificantDays(
  today: Date,
  days: SignificantDay[],
  windowDays: number
): UpcomingSignificantDay[] {
  const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const windowEndMs = todayMidnight + windowDays * 86_400_000;

  const results: UpcomingSignificantDay[] = [];
  for (const day of days) {
    let candidateMs = Date.UTC(today.getUTCFullYear(), day.month - 1, day.day);
    if (candidateMs < todayMidnight) {
      candidateMs = Date.UTC(today.getUTCFullYear() + 1, day.month - 1, day.day);
    }
    if (candidateMs <= windowEndMs) {
      results.push({ day, date: new Date(candidateMs) });
    }
  }

  results.sort((a, b) => a.date.getTime() - b.date.getTime());
  return results;
}
