-- =============================================================================
-- Admin Helpers — get_users_with_emails function + tags update policy for name editing
-- =============================================================================

-- Function to fetch users with their email addresses (from auth.users).
-- Only accessible to users with the manage_roles permission.
CREATE OR REPLACE FUNCTION public.get_users_with_emails()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  role_id UUID,
  role_name TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Permission guard: only manage_roles users may call this
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.manage_roles = true
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT p.id, u.email::TEXT, p.display_name, p.role_id, r.name, p.created_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.roles r ON p.role_id = r.id
  ORDER BY p.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow users with create_tags to update tag name and description.
-- The existing tags_update_is_folder policy only allows manage_folders users
-- to update tags (for the is_folder flag). We need a separate policy so that
-- users with create_tags can edit tag names and descriptions.
CREATE POLICY "tags_update_name_desc"
  ON public.tags FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('create_tags')));
