import { describe, it, expect } from 'vitest';
import { getUpcomingSignificantDays } from './calculator';
import { SignificantDay } from './types';

const WORLD_HEALTH_DAY: SignificantDay = { name: 'World Health Day', month: 4, day: 7 };
const HUMAN_RIGHTS_DAY: SignificantDay = { name: 'Human Rights Day', month: 12, day: 10 };
const NEW_YEAR: SignificantDay = { name: "New Year's Day", month: 1, day: 1 };
const IWD: SignificantDay = { name: "International Women's Day", month: 3, day: 8 };

const ALL_DAYS = [WORLD_HEALTH_DAY, HUMAN_RIGHTS_DAY, NEW_YEAR, IWD];

describe('getUpcomingSignificantDays', () => {
  it('includes a day exactly at the start of the window (today)', () => {
    const today = new Date('2026-04-07T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [WORLD_HEALTH_DAY], 7);
    expect(result).toHaveLength(1);
    expect(result[0].day.name).toBe('World Health Day');
  });

  it('includes a day exactly at the end of the window', () => {
    const today = new Date('2026-04-01T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [WORLD_HEALTH_DAY], 7);
    expect(result).toHaveLength(1);
  });

  it('excludes a day one day past the window', () => {
    const today = new Date('2026-03-31T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [WORLD_HEALTH_DAY], 6); // window ends Apr 6
    expect(result).toHaveLength(0);
  });

  it('excludes a day that already passed this year (and is not wrapping to next year)', () => {
    const today = new Date('2026-04-08T00:00:00Z'); // day after World Health Day
    const result = getUpcomingSignificantDays(today, [WORLD_HEALTH_DAY], 7);
    expect(result).toHaveLength(0);
  });

  it('wraps year-end: a day in early January is found when today is in late December', () => {
    const today = new Date('2026-12-28T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [NEW_YEAR], 7);
    expect(result).toHaveLength(1);
    expect(result[0].date.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('sorts results by upcoming date ascending', () => {
    const today = new Date('2026-01-01T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [IWD, NEW_YEAR], 100);
    expect(result.map(r => r.day.name)).toEqual(["New Year's Day", "International Women's Day"]);
  });

  it('returns an empty array when no days fall within the window', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    const result = getUpcomingSignificantDays(today, [NEW_YEAR], 7);
    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty input list', () => {
    expect(getUpcomingSignificantDays(new Date(), [], 7)).toEqual([]);
  });

  it('handles multiple days landing in the same window, all included', () => {
    const today = new Date('2026-12-05T00:00:00Z');
    const result = getUpcomingSignificantDays(today, ALL_DAYS, 30); // Dec 5 -> Jan 4: catches Human Rights Day + New Year
    expect(result.map(r => r.day.name)).toEqual(["Human Rights Day", "New Year's Day"]);
  });

  it('a zero-length window only matches a day that is exactly today', () => {
    const today = new Date('2026-04-07T00:00:00Z');
    expect(getUpcomingSignificantDays(today, [WORLD_HEALTH_DAY], 0)).toHaveLength(1);
    expect(getUpcomingSignificantDays(new Date('2026-04-08T00:00:00Z'), [WORLD_HEALTH_DAY], 0)).toHaveLength(0);
  });
});
