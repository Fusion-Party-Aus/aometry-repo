import { describe, it, expect } from 'vitest';
import { buildCommsCalendarEmbed } from './embed';
import { UpcomingSignificantDay } from './types';

const ITEM: UpcomingSignificantDay = {
  day: { name: 'World Health Day', month: 4, day: 7, description: 'WHO-designated day.' },
  date: new Date('2026-04-07T00:00:00Z'),
};

describe('buildCommsCalendarEmbed', () => {
  it('returns an object with a data property (EmbedBuilder shape)', () => {
    const embed = buildCommsCalendarEmbed([]);
    expect(embed).toHaveProperty('data');
  });

  it('shows a clear message when there are no upcoming days', () => {
    const embed = buildCommsCalendarEmbed([]);
    expect(JSON.stringify(embed.data).toLowerCase()).toContain('no upcoming');
  });

  it('mentions the day name when there are upcoming days', () => {
    const embed = buildCommsCalendarEmbed([ITEM]);
    expect(JSON.stringify(embed.data)).toContain('World Health Day');
  });

  it('includes the description when present', () => {
    const embed = buildCommsCalendarEmbed([ITEM]);
    expect(JSON.stringify(embed.data)).toContain('WHO-designated day.');
  });

  it('lists multiple days, each represented', () => {
    const second: UpcomingSignificantDay = {
      day: { name: 'Human Rights Day', month: 12, day: 10 },
      date: new Date('2026-12-10T00:00:00Z'),
    };
    const embed = buildCommsCalendarEmbed([ITEM, second]);
    const rendered = JSON.stringify(embed.data);
    expect(rendered).toContain('World Health Day');
    expect(rendered).toContain('Human Rights Day');
  });
});
