-- =============================================================================
-- recorded_at provenance
-- =============================================================================
-- media.recorded_at is a TIMESTAMPTZ: it stores an *instant*. That is enough to
-- order a library but not enough to display one, because the wall clock a class
-- was filmed at depends on the timezone it was filmed in. 46% of the library
-- carries a real UTC offset in its container metadata
-- (com.apple.quicktime.creationdate); the rest only yields a UTC instant, and a
-- timezone has to be assumed.
--
-- These columns record what we know and how we came to know it, so that:
--   * the UI can render the venue's wall clock rather than the viewer's
--   * a re-run of the backfill never overwrites a human's correction
--   * "date only" stops being indistinguishable from "filmed at midnight"
--
-- All three are nullable. NULL means "not yet classified" — distinct from
-- recorded_at_source = 'unknown', which means "classified, and there is no date
-- to be had". Populating them is a separate, reviewed backfill step.
-- =============================================================================

ALTER TABLE public.media
  ADD COLUMN recorded_at_offset_minutes SMALLINT,
  ADD COLUMN recorded_at_source         TEXT,
  ADD COLUMN recorded_at_precision      TEXT;

-- UTC offset in effect where and when the video was recorded, in minutes east of
-- UTC (Pacific Daylight Time = -420, Pacific Standard Time = -480). Real offsets
-- are only available from 'apple_atom'; for every other source the offset is an
-- assumption, which is why recorded_at_source must be read alongside it.
-- Range covers UTC-12:00 .. UTC+14:00, including 45-minute zones.
ALTER TABLE public.media
  ADD CONSTRAINT media_recorded_at_offset_range
  CHECK (recorded_at_offset_minutes BETWEEN -720 AND 840);

-- Where recorded_at came from. Ordered roughly most to least trustworthy.
--   apple_atom  com.apple.quicktime.creationdate — instant AND true offset
--   cday_atom   ©day user-data atom (Android, GoPro, cameras)
--   mvhd        mvhd.creation_time — a UTC instant, offset assumed
--   filename    timestamp parsed from the filename (WhatsApp, screen recordings)
--   manual      entered or corrected by a person — never overwrite automatically
--   inferred    derived indirectly, e.g. from neighbouring capture sequence numbers
--   unknown     examined, and the file carries no recoverable date
ALTER TABLE public.media
  ADD CONSTRAINT media_recorded_at_source_valid
  CHECK (recorded_at_source IN (
    'apple_atom', 'cday_atom', 'mvhd', 'filename', 'manual', 'inferred', 'unknown'
  ));

-- How much of recorded_at is meaningful. Without this, a value of midnight is
-- ambiguous between "we only know the day" and "it really was filmed at 00:00",
-- and code downstream has to guess (see the is_midnight() heuristics in
-- backfill_recorded_at.ipynb and dedup_audit.ipynb).
ALTER TABLE public.media
  ADD CONSTRAINT media_recorded_at_precision_valid
  CHECK (recorded_at_precision IN ('second', 'minute', 'day', 'unknown'));

-- Lets the backfill and any audit tooling find unclassified or low-confidence
-- rows without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_media_recorded_at_source
  ON media(recorded_at_source);
