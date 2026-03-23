-- Allow storage_path to be null for image uploads.
-- Images are stored in thumbs/ folder (as thumbnail_path) with no separate video file.
ALTER TABLE media ALTER COLUMN storage_path DROP NOT NULL;
