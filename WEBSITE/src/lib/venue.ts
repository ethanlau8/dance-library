// Venue time is defined in @shared/venueTime.ts so the browser and the edge
// functions cannot drift apart on it. Re-exported here because the app imports
// it from './venue', and the calendar-day helpers below are filter-only and
// have no server-side consumer.
export {
  VENUE_TIME_ZONE,
  offsetMinutesAt,
  parseDateOnly,
  venueDayStartISO,
  toVenueDatetimeLocal,
  fromVenueDatetimeLocal,
} from '@shared/venueTime.ts'

import { parseDateOnly } from '@shared/venueTime.ts'

/** The calendar day after `dateStr`, as `YYYY-MM-DD`. */
export function nextCalendarDay(dateStr: string): string | null {
  const parts = parseDateOnly(dateStr)
  if (!parts) return null
  const [y, m, d] = parts
  const next = new Date(Date.UTC(y, m - 1, d))
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
