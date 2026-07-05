import { describe, it, expect } from 'vitest';
import { getUpcomingEvents, isEventReminderDue, detectEventChanges } from './calculator';
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
    link: null,
    source: 'google',
    ...overrides,
  };
}

describe('getUpcomingEvents', () => {
  const NOW = new Date('2026-06-01T00:00:00Z');

  it('includes an event starting within the window', () => {
    const event = makeEvent({ startTime: new Date('2026-06-10T00:00:00Z') });
    expect(getUpcomingEvents([event], NOW, 60)).toEqual([event]);
  });

  it('excludes an event starting after the window', () => {
    const event = makeEvent({ startTime: new Date('2026-09-01T00:00:00Z') }); // >60 days out
    expect(getUpcomingEvents([event], NOW, 60)).toEqual([]);
  });

  it('excludes an event that already started in the past', () => {
    const event = makeEvent({ startTime: new Date('2026-05-01T00:00:00Z') });
    expect(getUpcomingEvents([event], NOW, 60)).toEqual([]);
  });

  it('includes an event starting exactly now', () => {
    const event = makeEvent({ startTime: NOW });
    expect(getUpcomingEvents([event], NOW, 60)).toEqual([event]);
  });

  it('sorts results by start time ascending', () => {
    const later = makeEvent({ id: 'evt-later', startTime: new Date('2026-06-15T00:00:00Z') });
    const sooner = makeEvent({ id: 'evt-sooner', startTime: new Date('2026-06-05T00:00:00Z') });
    expect(getUpcomingEvents([later, sooner], NOW, 60).map(e => e.id)).toEqual(['evt-sooner', 'evt-later']);
  });

  it('returns an empty array for an empty input list', () => {
    expect(getUpcomingEvents([], NOW, 60)).toEqual([]);
  });
});

describe('isEventReminderDue', () => {
  const NOW = new Date('2026-06-10T09:50:00Z');

  it('is due when the event starts within the reminder window', () => {
    const event = makeEvent({ startTime: new Date('2026-06-10T10:00:00Z') }); // 10 min away
    expect(isEventReminderDue(event, NOW, 15)).toBe(true);
  });

  it('is not due when the event is further away than the reminder window', () => {
    const event = makeEvent({ startTime: new Date('2026-06-10T10:30:00Z') }); // 40 min away
    expect(isEventReminderDue(event, NOW, 15)).toBe(false);
  });

  it('is not due once the event has already started', () => {
    const event = makeEvent({ startTime: new Date('2026-06-10T09:45:00Z') }); // 5 min ago
    expect(isEventReminderDue(event, NOW, 15)).toBe(false);
  });

  it('is due at exactly the reminder boundary', () => {
    const event = makeEvent({ startTime: new Date('2026-06-10T10:05:00Z') }); // exactly 15 min away
    expect(isEventReminderDue(event, NOW, 15)).toBe(true);
  });
});

describe('detectEventChanges', () => {
  it('classifies a new event id as created', () => {
    const current = [makeEvent({ id: 'new-evt' })];
    const result = detectEventChanges([], current);
    expect(result.created.map(e => e.id)).toEqual(['new-evt']);
    expect(result.changed).toEqual([]);
  });

  it('classifies a same-id event with a different startTime as changed', () => {
    const previous = [makeEvent({ id: 'evt-1', startTime: new Date('2026-06-10T10:00:00Z') })];
    const current = [makeEvent({ id: 'evt-1', startTime: new Date('2026-06-10T11:00:00Z') })];
    const result = detectEventChanges(previous, current);
    expect(result.created).toEqual([]);
    expect(result.changed.map(e => e.id)).toEqual(['evt-1']);
  });

  it('classifies a same-id event with a different title as changed', () => {
    const previous = [makeEvent({ id: 'evt-1', title: 'Old Title' })];
    const current = [makeEvent({ id: 'evt-1', title: 'New Title' })];
    const result = detectEventChanges(previous, current);
    expect(result.changed.map(e => e.id)).toEqual(['evt-1']);
  });

  it('classifies a same-id event with a different location as changed', () => {
    const previous = [makeEvent({ id: 'evt-1', location: 'Room A' })];
    const current = [makeEvent({ id: 'evt-1', location: 'Room B' })];
    const result = detectEventChanges(previous, current);
    expect(result.changed.map(e => e.id)).toEqual(['evt-1']);
  });

  it('does not classify an identical event as created or changed', () => {
    const event = makeEvent();
    const result = detectEventChanges([event], [{ ...event }]);
    expect(result.created).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('does not report a removed event as created or changed', () => {
    const previous = [makeEvent({ id: 'evt-1' })];
    const result = detectEventChanges(previous, []);
    expect(result.created).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('handles a mix of created, changed, and unchanged events in one call', () => {
    const previous = [
      makeEvent({ id: 'unchanged' }),
      makeEvent({ id: 'will-change', title: 'Before' }),
    ];
    const current = [
      makeEvent({ id: 'unchanged' }),
      makeEvent({ id: 'will-change', title: 'After' }),
      makeEvent({ id: 'brand-new' }),
    ];
    const result = detectEventChanges(previous, current);
    expect(result.created.map(e => e.id)).toEqual(['brand-new']);
    expect(result.changed.map(e => e.id)).toEqual(['will-change']);
  });
});
