import { describe, it, expect } from 'vitest';
import { formatEventEntry, buildUpcomingEventScheduleEmbed } from './embed';
import { CalendarEvent } from './types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Branch Meeting',
    description: null,
    location: null,
    startTime: new Date('2026-06-10T10:00:00Z'),
    endTime: new Date('2026-06-10T11:00:00Z'),
    allDay: false,
    link: 'https://example.com/event',
    source: 'google',
    ...overrides,
    };
}

describe('formatEventEntry', () => {
  it('includes the event title', () => {
    expect(formatEventEntry(makeEvent())).toContain('Branch Meeting');
  });

  it('links the title when a link is present', () => {
    const entry = formatEventEntry(makeEvent({ link: 'https://example.com/event' }));
    expect(entry).toContain('https://example.com/event');
  });

  it('marks an all-day event distinctly from a timed one', () => {
    const allDay = formatEventEntry(makeEvent({ allDay: true }));
    const timed = formatEventEntry(makeEvent({ allDay: false }));
    expect(allDay.toLowerCase()).toContain('all day');
    expect(timed.toLowerCase()).not.toContain('all day');
  });

  it('includes location when present', () => {
    const entry = formatEventEntry(makeEvent({ location: 'Community Hall' }));
    expect(entry).toContain('Community Hall');
  });

  it('does not mention location when absent', () => {
    const entry = formatEventEntry(makeEvent({ location: null }));
    expect(entry.toLowerCase()).not.toContain('location');
  });
});

describe('buildUpcomingEventScheduleEmbed', () => {
  it('returns an object with a data property (EmbedBuilder shape)', () => {
    expect(buildUpcomingEventScheduleEmbed([])).toHaveProperty('data');
  });

  it('shows a clear message when there are no upcoming events', () => {
    const embed = buildUpcomingEventScheduleEmbed([]);
    expect(JSON.stringify(embed.data).toLowerCase()).toContain('no upcoming');
  });

  it('groups events by day, one field per day', () => {
    const day1a = makeEvent({ id: 'a', startTime: new Date('2026-06-10T10:00:00Z') });
    const day1b = makeEvent({ id: 'b', title: 'Second Meeting', startTime: new Date('2026-06-10T14:00:00Z') });
    const day2 = makeEvent({ id: 'c', title: 'Next Day Event', startTime: new Date('2026-06-11T10:00:00Z') });
    const embed = buildUpcomingEventScheduleEmbed([day1a, day1b, day2]);
    expect(embed.data.fields).toHaveLength(2);
  });

  it('mentions every event title somewhere in the embed', () => {
    const events = [
      makeEvent({ id: 'a', title: 'Event A', startTime: new Date('2026-06-10T10:00:00Z') }),
      makeEvent({ id: 'b', title: 'Event B', startTime: new Date('2026-06-11T10:00:00Z') }),
    ];
    const rendered = JSON.stringify(buildUpcomingEventScheduleEmbed(events).data);
    expect(rendered).toContain('Event A');
    expect(rendered).toContain('Event B');
  });
});
