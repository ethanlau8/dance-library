-- =============================================================================
-- Fix: RLS infinite recursion on profiles table (error 42P17)
-- Run this in the Supabase SQL Editor to patch the live database.
-- =============================================================================

-- 1. Create the SECURITY DEFINER helper function
CREATE OR REPLACE FUNCTION public.user_has_permission(permission TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT
      CASE permission
        WHEN 'view_media' THEN r.view_media
        WHEN 'upload_media' THEN r.upload_media
        WHEN 'edit_metadata' THEN r.edit_metadata
        WHEN 'delete_media' THEN r.delete_media
        WHEN 'manage_roles' THEN r.manage_roles
        WHEN 'create_tags' THEN r.create_tags
        WHEN 'manage_folders' THEN r.manage_folders
        ELSE false
      END
     FROM public.profiles p
     JOIN public.roles r ON p.role_id = r.id
     WHERE p.id = auth.uid()
    ),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. Drop and recreate all affected policies

-- profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR (SELECT public.user_has_permission('manage_roles'))
  );

DROP POLICY IF EXISTS "profiles_update_role_id" ON public.profiles;
CREATE POLICY "profiles_update_role_id"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    id != auth.uid()
    AND (SELECT public.user_has_permission('manage_roles'))
    AND NOT (
      EXISTS (
        SELECT 1 FROM public.roles r2
        WHERE r2.id = profiles.role_id AND r2.name = 'Owner'
      )
      AND public.is_last_owner(profiles.id)
    )
  );

-- roles
DROP POLICY IF EXISTS "roles_insert_manage_roles" ON public.roles;
CREATE POLICY "roles_insert_manage_roles"
  ON public.roles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('manage_roles')));

DROP POLICY IF EXISTS "roles_update_manage_roles" ON public.roles;
CREATE POLICY "roles_update_manage_roles"
  ON public.roles FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_roles')));

DROP POLICY IF EXISTS "roles_delete_manage_roles" ON public.roles;
CREATE POLICY "roles_delete_manage_roles"
  ON public.roles FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_roles')));

-- media
DROP POLICY IF EXISTS "media_select" ON public.media;
CREATE POLICY "media_select"
  ON public.media FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

DROP POLICY IF EXISTS "media_insert" ON public.media;
CREATE POLICY "media_insert"
  ON public.media FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('upload_media')));

DROP POLICY IF EXISTS "media_update" ON public.media;
CREATE POLICY "media_update"
  ON public.media FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('edit_metadata')));

DROP POLICY IF EXISTS "media_delete" ON public.media;
CREATE POLICY "media_delete"
  ON public.media FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR (SELECT public.user_has_permission('delete_media'))
  );

-- tag_categories
DROP POLICY IF EXISTS "tag_categories_select" ON public.tag_categories;
CREATE POLICY "tag_categories_select"
  ON public.tag_categories FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

DROP POLICY IF EXISTS "tag_categories_insert" ON public.tag_categories;
CREATE POLICY "tag_categories_insert"
  ON public.tag_categories FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('create_tags')));

-- tags
DROP POLICY IF EXISTS "tags_select" ON public.tags;
CREATE POLICY "tags_select"
  ON public.tags FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

DROP POLICY IF EXISTS "tags_insert" ON public.tags;
CREATE POLICY "tags_insert"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('create_tags')));

DROP POLICY IF EXISTS "tags_update_is_folder" ON public.tags;
CREATE POLICY "tags_update_is_folder"
  ON public.tags FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_folders')));

-- media_tags
DROP POLICY IF EXISTS "media_tags_select" ON public.media_tags;
CREATE POLICY "media_tags_select"
  ON public.media_tags FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

DROP POLICY IF EXISTS "media_tags_insert" ON public.media_tags;
CREATE POLICY "media_tags_insert"
  ON public.media_tags FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('edit_metadata')));

DROP POLICY IF EXISTS "media_tags_delete" ON public.media_tags;
CREATE POLICY "media_tags_delete"
  ON public.media_tags FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('edit_metadata')));
