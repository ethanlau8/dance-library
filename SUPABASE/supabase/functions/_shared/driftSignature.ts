import { offsetMinutesAt } from "./venueTime.ts";

// ─── Recognising edit drift ─────────────────────────────────────────────────
//
// Deciding whether to overwrite a stored date is the riskiest judgement the
// backfill makes, so it is made by rule rather than by threshold.
//
// A defect in the metadata editor shifted `recorded_at` forward by exactly one
// venue offset on every save, and truncated the seconds. Saving three times
// moved a record 21 or 24 hours depending on the season. Those records are
// mechanically explainable and safe to correct.
//
// A flat "quarantine anything past N hours" rule cannot express that. It would
// pass a genuinely wrong record that happens to sit 20 hours out, and quarantine
// a four-save drift as though it were a mystery. Worse, the boundary is
// arbitrary: one real record landed 4 minutes inside a 24-hour threshold.
//
// So: match the fingerprint. Anything that fits is drift; anything that does
// not is quarantined for a human, however small.

export interface DriftVerdict {
  isDrift: boolean
  /** How many times the record was saved, when the fingerprint matches. */
  saves: number | null
  /** Offset magnitude in minutes that explains the shift (420 PDT / 480 PST). */
  offsetMinutes: number | null
}

/** Largest plausible number of repeat saves. Beyond this, treat it as unknown. */
const MAX_SAVES = 8

/**
 * Does the gap between the stored value and the file's own timestamp match the
 * editor defect?
 *
 * @param stored   what the database holds
 * @param actual   what the container says
 */
export function classifyDrift(stored: Date, actual: Date): DriftVerdict {
  const none: DriftVerdict = { isDrift: false, saves: null, offsetMinutes: null }

  // The editor truncated to the minute, so a drifted value always lands on :00.
  // The container's own timestamps almost never do, which makes this a cheap and
  // highly specific discriminator.
  if (stored.getUTCSeconds() !== 0 || stored.getUTCMilliseconds() !== 0) return none

  // Compare at minute resolution: the seconds the editor discarded would
  // otherwise make an exact multiple look 16 seconds short of one.
  const storedMin = Math.round(stored.getTime() / 60_000)
  const actualMin = Math.floor(actual.getTime() / 60_000)
  const gap = storedMin - actualMin
  if (gap <= 0) return none // the defect only ever moved values forward

  // Use the offset in effect at the true recording time, not at the drifted one.
  const offset = Math.abs(offsetMinutesAt(actual))
  if (offset === 0) return none

  const saves = gap / offset
  if (!Number.isInteger(saves) || saves < 1 || saves > MAX_SAVES) return none

  return { isDrift: true, saves, offsetMinutes: offset }
}
