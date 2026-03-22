-- =============================================================================
-- Add original file metadata columns to media table
-- =============================================================================

ALTER TABLE public.media
  ADD COLUMN original_filename  TEXT,
  ADD COLUMN file_size_bytes    BIGINT,
  ADD COLUMN mime_type          TEXT,
  ADD COLUMN resolution         TEXT;
