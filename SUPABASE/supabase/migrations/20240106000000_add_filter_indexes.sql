-- Speed up tag-based media filtering (useMedia queries media_tags by tag_id)
CREATE INDEX IF NOT EXISTS idx_media_tags_tag_id ON media_tags(tag_id);

-- Speed up fetching tags for displayed media (useMedia queries media_tags by media_id)
CREATE INDEX IF NOT EXISTS idx_media_tags_media_id ON media_tags(media_id);

-- Speed up date range filtering and sorting
CREATE INDEX IF NOT EXISTS idx_media_recorded_at ON media(recorded_at);
CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at);
