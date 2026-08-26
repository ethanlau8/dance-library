import { fromVenueDatetimeLocal } from './venue'
import type { ExtractedDate } from '@shared/mp4Date.ts'

export interface RecordedAtFields {
  recorded_at: string | null
  recorded_at_source: string | null
  recorded_at_offset_minutes: number | null
  recorded_at_precision: string | null
}

/**
 * Build the four recorded_at columns for an upload.
 *
 * Both upload paths need this identically, and they are otherwise ~90%
 * duplicated code that has already drifted apart once — so it lives here rather
 * than being written twice.
 *
 * `wallClock` is the venue-local value shown in the form; `extracted` is what
 * the container parser found, or null if nothing was found. `edited` says the
 * user typed in the field.
 *
 * When the user has edited the value, their input wins and provenance becomes
 * `manual`: the extracted offset no longer describes the instant they entered,
 * and the backfill must never overwrite a human's correction. Otherwise the
 * parser's own attribution carries through, so a row is correctly described
 * from the moment it is created rather than waiting on a later pass.
 */
export function buildRecordedAtFields(
  wallClock: string,
  extracted: ExtractedDate | null,
  edited: boolean,
): RecordedAtFields {
  const recorded_at = fromVenueDatetimeLocal(wallClock)
  if (!recorded_at) {
    return {
      recorded_at: null,
      recorded_at_source: null,
      recorded_at_offset_minutes: null,
      recorded_at_precision: null,
    }
  }

  if (edited || !extracted?.instant) {
    return {
      recorded_at,
      recorded_at_source: 'manual',
      recorded_at_offset_minutes: null,
      recorded_at_precision: 'second',
    }
  }

  return {
    recorded_at,
    recorded_at_source: extracted.source,
    // Only the Apple atom states a real offset; everything else leaves it null
    // rather than asserting an assumption as fact.
    recorded_at_offset_minutes: extracted.offsetMinutes,
    recorded_at_precision: extracted.precision,
  }
}
