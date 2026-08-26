import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatVenueDate,
  formatCalendarDate,
  sameInstant,
  formatFileSize,
  formatDuration,
} from './format'

// The suite runs under TZ=Asia/Tokyo (see vitest.config.ts), so any function
// that leaks the browser's timezone gives a visibly wrong answer here.

describe('formatVenueDate', () => {
  it('renders the date the recording fell on at the venue', () => {
    // 02:07:20Z is the 23rd in UTC and the 24th in Tokyo, but the class was
    // filmed on the evening of the 22nd. 326 of 372 videos displayed the wrong
    // date from Tokyo before this existed.
    expect(formatVenueDate('2025-11-23T02:07:20+00:00')).toBe('Nov 22, 2025')
  })

  it('prefers an explicit per-recording offset when given one', () => {
    const instant = '2026-03-15T18:30:00Z'
    expect(formatVenueDate(instant, -420)).toBe('Mar 15, 2026') // PDT
    expect(formatVenueDate(instant, 345)).toBe('Mar 16, 2026') // Kathmandu +05:45
    expect(formatVenueDate(instant, 825)).toBe('Mar 16, 2026') // Chatham +13:45
  })

  it('handles offsets that are not whole hours', () => {
    // Adelaide is +09:30; naive hour arithmetic would land on the wrong day.
    expect(formatVenueDate('2026-03-15T14:45:00Z', 570)).toBe('Mar 16, 2026')
  })

  it('returns empty string for null and unparseable input', () => {
    expect(formatVenueDate(null)).toBe('')
    expect(formatVenueDate('garbage')).toBe('')
  })
})

describe('formatCalendarDate', () => {
  it('does not shift a calendar date by a timezone', () => {
    // new Date('2026-03-15') is UTC midnight, which renders as the 14th for any
    // viewer west of UTC — the filter chip said "Mar 14" when you picked Mar 15.
    expect(formatCalendarDate('2026-03-15')).toBe('Mar 15, 2026')
    expect(formatCalendarDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatCalendarDate('2026-12-31')).toBe('Dec 31, 2026')
  })

  it('rejects impossible and malformed dates', () => {
    expect(formatCalendarDate('2026-02-31')).toBe('')
    expect(formatCalendarDate('nonsense')).toBe('')
    expect(formatCalendarDate(null)).toBe('')
  })
})

describe('formatDate', () => {
  it('renders account events in the viewer timezone', () => {
    // Deliberately different from formatVenueDate: "signed up" happened wherever
    // the person was, not at the studio. This instant is late evening at the
    // venue but already the next day in both suite timezones, so the two
    // functions must disagree whichever config is running.
    const instant = '2026-03-16T04:00:00Z'
    expect(formatVenueDate(instant)).toBe('Mar 15, 2026')
    expect(formatDate(instant)).toBe('Mar 16, 2026')
  })

  it('returns empty string for null and unparseable input', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('garbage')).toBe('')
  })
})

describe('sameInstant', () => {
  it('compares moments, not strings', () => {
    // The save path used string equality, so a semantically identical timestamp
    // in a different format always looked like a change and was rewritten.
    expect(sameInstant('2025-11-23T02:07:20+00:00', '2025-11-23T02:07:20.000Z')).toBe(true)
    expect(sameInstant('2025-11-23T02:07:20Z', '2025-11-23T02:07:21Z')).toBe(false)
  })

  it('treats null consistently in both directions', () => {
    expect(sameInstant(null, null)).toBe(true)
    expect(sameInstant(null, '2025-11-23T02:07:20Z')).toBe(false)
    expect(sameInstant('2025-11-23T02:07:20Z', null)).toBe(false)
  })
})

describe('formatFileSize', () => {
  it('scales units', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})

describe('formatDuration', () => {
  it('pads and includes hours only when needed', () => {
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(69)).toBe('1:09')
    expect(formatDuration(3661)).toBe('1:01:01')
  })
})
