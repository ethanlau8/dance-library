// ─── Venue timezone ─────────────────────────────────────────────────────────
// The library records classes at a single venue. `media.recorded_at` is a
// TIMESTAMPTZ — an instant — but the questions users ask are calendar questions
// ("what did we film on the 15th?"), and a calendar day only exists relative to
// a timezone. Every UTC offset found in the library's own file metadata is
// -07:00 or -08:00, so the venue is Pacific.
//
// This is the fallback used when a record has no recorded_at_offset_minutes of
// its own — 54% of the library, whose containers record a UTC instant without
// an offset. Where a real offset exists, prefer it.
export const VENUE_TIME_ZONE = 'America/Los_Angeles'

/**
 * The UTC offset, in minutes east of UTC, in effect in `timeZone` at `instant`.
 * Pacific Daylight Time returns -420, Pacific Standard Time -480.
 */
export function offsetMinutesAt(instant: Date, timeZone: string = VENUE_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asIfUtc = Date.UTC(
    at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second')
  )
  // Compare against the instant truncated to whole seconds, since the formatted
  // parts carry no milliseconds.
  return (asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000
}

/**
 * Convert a wall-clock time in `timeZone` to the instant it denotes.
 * Two passes, because the offset itself depends on the instant we're solving for
 * — one pass is wrong for wall-clock times near a DST transition.
 */
function zonedWallClockToInstant(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number, ms: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  const firstPass = offsetMinutesAt(new Date(guess), timeZone)
  let instant = guess - firstPass * 60_000
  const secondPass = offsetMinutesAt(new Date(instant), timeZone)
  if (secondPass !== firstPass) instant = guess - secondPass * 60_000
  return new Date(instant)
}

export function parseDateOnly(dateStr: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Reject calendar-impossible dates. The shape regex accepts 2026-02-31, and
  // Date silently normalises it to March 3 — so a filter would quietly answer a
  // question nobody asked.
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null
  }
  return [y, mo, d]
}

/**
 * First instant of the given venue-local calendar day, as an ISO string.
 * `'2026-03-15'` → `'2026-03-15T07:00:00.000Z'` during PDT.
 */
export function venueDayStartISO(dateStr: string, timeZone: string = VENUE_TIME_ZONE): string | null {
  const parts = parseDateOnly(dateStr)
  if (!parts) return null
  const [y, m, d] = parts
  return zonedWallClockToInstant(y, m, d, 0, 0, 0, 0, timeZone).toISOString()
}

// ─── <input type="datetime-local"> round-trip, in venue time ────────────────
// A datetime-local value is a wall clock with no timezone; recorded_at is an
// instant. Converting through the *browser's* zone means an admin editing from
// another timezone sees different numbers than the venue did, and — since the
// rest of the UI renders venue time — the editor would contradict the page it
// sits on. Both directions therefore pin to the venue.

/** Instant (ISO string) → value for a datetime-local input, in venue time. */
export function toVenueDatetimeLocal(iso: string | null, timeZone: string = VENUE_TIME_ZONE): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}:${at('second')}`
}

/**
 * Venue wall clock → instant (ISO string).
 *
 * Accepts what a datetime-local input produces (`YYYY-MM-DDTHH:MM[:SS]`) and
 * also the looser shapes container metadata uses: a bare date, and a space
 * instead of `T`. The `©day` atom in particular may hold only `2015-03-08`,
 * which denotes venue midnight rather than nothing at all.
 */
export function fromVenueDatetimeLocal(value: string, timeZone: string = VENUE_TIME_ZONE): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!m) return null
  const [y, mo, d] = m.slice(1, 4).map(Number)
  const h = m[4] ? Number(m[4]) : 0
  const mi = m[5] ? Number(m[5]) : 0
  const s = m[6] ? Number(m[6]) : 0
  if (h > 23 || mi > 59 || s > 59) return null
  // Reject calendar-impossible dates rather than letting Date normalise them.
  if (!parseDateOnly(`${m[1]}-${m[2]}-${m[3]}`)) return null
  const instant = zonedWallClockToInstant(y, mo, d, h, mi, s, 0, timeZone)
  return isNaN(instant.getTime()) ? null : instant.toISOString()
}

/** The calendar day after `dateStr`, as `YYYY-MM-DD`. */
export function nextCalendarDay(dateStr: string): string | null {
  const parts = parseDateOnly(dateStr)
  if (!parts) return null
  const [y, m, d] = parts
  const next = new Date(Date.UTC(y, m - 1, d))
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
