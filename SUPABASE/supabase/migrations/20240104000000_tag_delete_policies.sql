-- =============================================================================
-- Tag & category management: DELETE policies, cascade fix, category UPDATE
-- =============================================================================

-- Fix media_tags.tag_id to cascade deletes (so deleting a tag removes its
-- media associations automatically instead of blocking with a FK error)
ALTER TABLE public.media_tags
  DROP CONSTRAINT media_tags_tag_id_fkey,
  ADD CONSTRAINT media_tags_tag_id_fkey
    FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

-- Allow users with create_tags to delete tags
CREATE POLICY "tags_delete"
  ON public.tags FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('create_tags')));

-- Allow users with create_tags to delete empty categories
CREATE POLICY "tag_categories_delete"
  ON public.tag_categories FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('create_tags')));

-- Allow users with create_tags to rename categories
CREATE POLICY "tag_categories_update"
  ON public.tag_categories FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('create_tags')));
