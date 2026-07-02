/**
 * Comms Calendar live configuration — the days-of-significance list and refresh window.
 *
 * Starter set only, not comprehensive — a representative sample of fixed-date UN
 * International Days. Expand as needed; each entry is a one-line addition, no logic
 * touched. v1 only supports fixed month/day observances (getUpcomingSignificantDays has
 * no concept of "nth weekday of the month"), so movable dates — including the manual's own
 * example, World Day of Remembrance for Road Traffic Victims (3rd Sunday of November) —
 * are not representable yet and are intentionally omitted rather than approximated.
 */

import { SignificantDay } from './types';

export const SIGNIFICANT_DAYS: SignificantDay[] = [
  { name: 'International Day of Education', month: 1, day: 24 },
  { name: 'International Mother Language Day', month: 2, day: 21 },
  { name: "International Women's Day", month: 3, day: 8 },
  { name: 'World Health Day', month: 4, day: 7 },
  { name: 'International Youth Day', month: 8, day: 12 },
  { name: 'International Day of Peace', month: 9, day: 21 },
  { name: 'World Mental Health Day', month: 10, day: 10 },
  { name: "Universal Children's Day", month: 11, day: 20 },
  { name: 'Human Rights Day', month: 12, day: 10 },
];

/** Days ahead to show in the standing embed, matching the manual: "the upcoming week." */
export const WINDOW_DAYS = 7;
