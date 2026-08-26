import { VENUE_TIME_ZONE, parseDateOnly } from './venue'

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

const DAY_FORMAT = { month: 'short', day: 'numeric', year: 'numeric' } as const

/**
 * Format an instant as a calendar date in the *viewer's* timezone.
 * Correct for account events — "signed up", "joined" — which happen wherever the
 * person happened to be. For anything filmed at the venue use formatVenueDate.
 */
export function formatDate(date: string | Date | null): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', DAY_FORMAT)
}

/**
 * Format an instant as the calendar date it fell on *at the venue*.
 *
 * `recorded_at` is an instant, but "what day was this class?" is a question
 * about the studio's calendar, not the viewer's. 51% of the library has a UTC
 * date that differs from its venue date — the recording peak is 22:00 Pacific,
 * which is the following day in UTC — so rendering in the viewer's zone moves
 * evening classes onto the wrong day for anyone outside Pacific.
 *
 * Pass `offsetMinutes` when the record carries its own recorded_at_offset_minutes;
 * otherwise the venue's timezone is applied.
 */
export function formatVenueDate(
  instant: string | Date | null,
  offsetMinutes?: number | null,
): string {
  if (!instant) return ''
  const d = typeof instant === 'string' ? new Date(instant) : instant
  if (isNaN(d.getTime())) return ''
  if (offsetMinutes != null) {
    // Shift into the recording's own offset, then read the clock face in UTC.
    const shifted = new Date(d.getTime() + offsetMinutes * 60_000)
    return shifted.toLocaleDateString('en-US', { ...DAY_FORMAT, timeZone: 'UTC' })
  }
  return d.toLocaleDateString('en-US', { ...DAY_FORMAT, timeZone: VENUE_TIME_ZONE })
}

/**
 * Format a plain `YYYY-MM-DD` calendar date — filter bounds from the URL, for
 * instance. Deliberately does no timezone conversion: a calendar date denotes no
 * instant, and `new Date('2026-03-15')` is parsed as UTC midnight, which renders
 * as the 14th for every viewer west of UTC.
 */
export function formatCalendarDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const parts = parseDateOnly(dateStr)
  if (!parts) return ''
  const [y, m, d] = parts
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { ...DAY_FORMAT, timeZone: 'UTC' })
}

// datetime-local round-trip lives in ./venue — both directions must pin to the
// venue timezone, not the browser's, so that the editor agrees with the dates
// rendered by formatVenueDate above.

/** True when two nullable instants refer to the same moment. */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (isNaN(ta) || isNaN(tb)) return a === b
  return ta === tb
}
