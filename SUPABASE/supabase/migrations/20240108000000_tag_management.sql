-- =============================================================================
-- Tag management: editable tags, and a usage count per tag
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Allow create_tags to rename / re-describe / re-categorise tags
-- -----------------------------------------------------------------------------
--
-- The only UPDATE policy on `tags` was "tags_update_is_folder", which requires
-- `manage_folders`. RLS policies cannot be scoped to a column, so despite the
-- name that policy governed *every* update to the table — including the tag
-- rename and description edits the Tags screen offers to anyone holding
-- `create_tags`.
--
-- The seeded Editor role has create_tags but not manage_folders, so for an
-- Editor those updates matched zero rows. PostgREST reports a zero-row UPDATE
-- as success, so the UI showed the edit as saved and it silently reverted on
-- the next load.
--
-- Fix: let either permission through the policy, then enforce the actual
-- column split in a trigger, which *can* see which columns changed.

DROP POLICY IF EXISTS "tags_update_is_folder" ON public.tags;

CREATE POLICY "tags_update"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.user_has_permission('create_tags'))
    OR (SELECT public.user_has_permission('manage_folders'))
  )
  WITH CHECK (
    (SELECT public.user_has_permission('create_tags'))
    OR (SELECT public.user_has_permission('manage_folders'))
  );

-- Column-level enforcement: `is_folder` stays behind `manage_folders`, and the
-- editable metadata stays behind `create_tags`. Raising insufficient_privilege
-- (42501) means a caller lacking the permission gets a real error rather than
-- the silent no-op that motivated this migration.
CREATE OR REPLACE FUNCTION public.enforce_tag_update_permissions()
RETURNS trigger AS $$
BEGIN
  -- No end user in scope: service-role clients and maintenance scripts run
  -- without a JWT. RLS already gates every authenticated path to this point.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_folder IS DISTINCT FROM OLD.is_folder
     AND NOT public.user_has_permission('manage_folders') THEN
    RAISE EXCEPTION 'manage_folders permission is required to change folder status'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.name        IS DISTINCT FROM OLD.name
   OR NEW.description IS DISTINCT FROM OLD.description
   OR NEW.category_id IS DISTINCT FROM OLD.category_id)
     AND NOT public.user_has_permission('create_tags') THEN
    RAISE EXCEPTION 'create_tags permission is required to edit tags'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS enforce_tag_update_permissions ON public.tags;
CREATE TRIGGER enforce_tag_update_permissions
  BEFORE UPDATE ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tag_update_permissions();

-- -----------------------------------------------------------------------------
-- 2. tag_usage_counts — how many media items each tag is applied to
-- -----------------------------------------------------------------------------
--
-- The Tags screen needs this to be legible at scale: without it there is no way
-- to tell a tag carrying 40 videos from a typo applied once, which is exactly
-- the judgement call needed when reorganising a large vocabulary.
--
-- Counting client-side would mean pulling every media_tags row just to bucket
-- them, so aggregate in the database instead.
--
-- DISTINCT media_id because a tag may be applied to the same item several times
-- as separate timestamp ranges; the useful number is "on how many videos", not
-- "how many applications".

CREATE OR REPLACE VIEW public.tag_usage_counts
WITH (security_invoker = true) AS
SELECT
  t.id                             AS tag_id,
  COUNT(DISTINCT mt.media_id)      AS media_count
FROM public.tags t
LEFT JOIN public.media_tags mt ON mt.tag_id = t.id
GROUP BY t.id;

-- security_invoker makes the view run as the caller, so the existing
-- view_media-gated RLS on tags and media_tags applies unchanged.
GRANT SELECT ON public.tag_usage_counts TO authenticated;
