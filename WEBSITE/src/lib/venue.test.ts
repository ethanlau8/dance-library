import { describe, it, expect } from 'vitest'
import {
  VENUE_TIME_ZONE,
  offsetMinutesAt,
  toVenueDatetimeLocal,
  fromVenueDatetimeLocal,
  venueDayStartISO,
  nextCalendarDay,
  parseDateOnly,
} from './venue'

// These are regression tests. Each one corresponds to a defect that actually
// shipped, so the comments record the bug rather than restating the assertion.

describe('test environment', () => {
  it('runs somewhere that is neither UTC nor the venue', () => {
    // If this fails the rest of the suite still passes but proves much less:
    // browser-local and venue-local answers would coincide.
    const offset = -new Date('2026-06-15T12:00:00Z').getTimezoneOffset()
    expect(offset).not.toBe(0)
    expect(offset).not.toBe(offsetMinutesAt(new Date('2026-06-15T12:00:00Z')))
  })
})

describe('offsetMinutesAt', () => {
  it('tracks Pacific DST', () => {
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z'))).toBe(-480) // PST
    expect(offsetMinutesAt(new Date('2026-07-15T12:00:00Z'))).toBe(-420) // PDT
  })

  it('handles pre-epoch instants', () => {
    // The millisecond truncation uses Math.floor, which behaves differently for
    // negative timestamps if written carelessly.
    expect(offsetMinutesAt(new Date('1965-06-15T12:00:00Z'))).toBe(-420)
  })
})

describe('toVenueDatetimeLocal', () => {
  it('renders the venue wall clock, not the browser wall clock', () => {
    // The original bug: recorded_at.slice(0, 16) handed the editor UTC digits.
    // 02:07:20Z is 18:07:20 the previous day at the venue.
    expect(toVenueDatetimeLocal('2025-11-23T02:07:20+00:00')).toBe('2025-11-22T18:07:20')
  })

  it('keeps seconds', () => {
    // slice(0, 16) dropped them, so every save quietly rounded to the minute.
    expect(toVenueDatetimeLocal('2025-11-23T02:07:20Z')).toMatch(/T\d{2}:\d{2}:\d{2}$/)
  })

  it('returns empty string for null and unparseable input', () => {
    expect(toVenueDatetimeLocal(null)).toBe('')
    expect(toVenueDatetimeLocal('garbage')).toBe('')
  })
})

describe('fromVenueDatetimeLocal', () => {
  it('interprets a wall clock as venue time', () => {
    expect(fromVenueDatetimeLocal('2025-11-22T18:07:20')).toBe('2025-11-23T02:07:20.000Z')
  })

  it('accepts the shapes container metadata actually uses', () => {
    // The ©day atom may hold a bare date or use a space separator. Routing it
    // through a datetime-local-only parser turned those into null.
    expect(fromVenueDatetimeLocal('2015-03-08')).toBe('2015-03-08T08:00:00.000Z')
    expect(fromVenueDatetimeLocal('2015-03-08 14:03:35')).toBe('2015-03-08T21:03:35.000Z')
    expect(fromVenueDatetimeLocal('2015-03-08T14:03')).toBe('2015-03-08T21:03:00.000Z')
  })

  it('rejects values that are not dates', () => {
    expect(fromVenueDatetimeLocal('2015')).toBeNull()
    expect(fromVenueDatetimeLocal('')).toBeNull()
    expect(fromVenueDatetimeLocal('garbage')).toBeNull()
  })

  it('rejects calendar-impossible dates rather than normalising them', () => {
    expect(fromVenueDatetimeLocal('2026-02-31T10:00:00')).toBeNull()
  })
})

describe('datetime-local round trip', () => {
  // Real recorded_at values spanning both DST offsets and both sides of UTC
  // midnight. Opening the editor and saving without touching the field must not
  // move the instant — the defect that made 23 of 23 edited rows wrong.
  const instants = [
    '2025-11-23T02:07:20+00:00',
    '2026-01-20T06:00:44+00:00',
    '2026-02-25T06:06:24+00:00',
    '2025-04-09T03:16:47+00:00',
    '2026-07-25T05:52:43+00:00',
    '2024-08-29T04:20:11+00:00',
    '2026-05-06T05:14:02+00:00',
  ]

  it.each(instants)('is lossless for %s', (iso) => {
    const roundTripped = fromVenueDatetimeLocal(toVenueDatetimeLocal(iso))
    expect(new Date(roundTripped!).getTime()).toBe(new Date(iso).getTime())
  })
})

describe('parseDateOnly', () => {
  it('rejects impossible dates', () => {
    // Date silently normalises 2026-02-31 to March 3, so a filter would answer
    // a question nobody asked.
    expect(parseDateOnly('2026-02-31')).toBeNull()
    expect(parseDateOnly('2026-02-29')).toBeNull() // 2026 is not a leap year
    expect(parseDateOnly('2026-13-01')).toBeNull()
  })

  it('accepts real dates including leap days', () => {
    expect(parseDateOnly('2026-03-15')).toEqual([2026, 3, 15])
    expect(parseDateOnly('2028-02-29')).toEqual([2028, 2, 29])
  })

  it('rejects malformed shapes', () => {
    expect(parseDateOnly('2026-3-15')).toBeNull()
    expect(parseDateOnly('')).toBeNull()
  })
})

describe('venueDayStartISO', () => {
  it('starts the day at venue midnight, not UTC midnight', () => {
    // The filter bug: a bare date resolves to 00:00Z, which is mid-afternoon the
    // previous day at the venue.
    expect(venueDayStartISO('2026-07-15')).toBe('2026-07-15T07:00:00.000Z') // PDT
    expect(venueDayStartISO('2026-01-15')).toBe('2026-01-15T08:00:00.000Z') // PST
  })

  it('is correct on both sides of both DST transitions', () => {
    expect(venueDayStartISO('2026-03-08')).toBe('2026-03-08T08:00:00.000Z') // spring forward
    expect(venueDayStartISO('2026-03-09')).toBe('2026-03-09T07:00:00.000Z')
    expect(venueDayStartISO('2026-11-01')).toBe('2026-11-01T07:00:00.000Z') // fall back
    expect(venueDayStartISO('2026-11-02')).toBe('2026-11-02T08:00:00.000Z')
  })

  it('produces a 23–25 hour span for every day of the year', () => {
    // A sweep rather than spot checks: the only days that may deviate from 24h
    // are the two transitions, and they must deviate by exactly one hour.
    const spans = new Set<number>()
    const cursor = new Date(Date.UTC(2026, 0, 1))
    for (let i = 0; i < 365; i++) {
      const day = cursor.toISOString().slice(0, 10)
      const start = venueDayStartISO(day)
      const end = venueDayStartISO(nextCalendarDay(day)!)
      expect(start).not.toBeNull()
      expect(end).not.toBeNull()
      spans.add((new Date(end!).getTime() - new Date(start!).getTime()) / 3_600_000)
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    expect([...spans].sort()).toEqual([23, 24, 25])
  })

  it('returns null for input it cannot trust', () => {
    expect(venueDayStartISO('2026-02-31')).toBeNull()
    expect(venueDayStartISO('nonsense')).toBeNull()
  })
})

describe('nextCalendarDay', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(nextCalendarDay('2026-03-15')).toBe('2026-03-16')
    expect(nextCalendarDay('2026-01-31')).toBe('2026-02-01')
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01')
    expect(nextCalendarDay('2028-02-28')).toBe('2028-02-29')
  })
})

describe('VENUE_TIME_ZONE', () => {
  it('is an IANA zone, not a fixed offset', () => {
    // A hardcoded -08:00 would be wrong for roughly half the year: the library
    // contains recordings at both -0800 and -0700.
    expect(VENUE_TIME_ZONE).toBe('America/Los_Angeles')
    expect(offsetMinutesAt(new Date('2026-01-15T12:00:00Z')))
      .not.toBe(offsetMinutesAt(new Date('2026-07-15T12:00:00Z')))
  })
})
