-- =============================================================================
-- Dance Library — Initial Schema
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ROLES
-- -----------------------------------------------------------------------------
CREATE TABLE public.roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  view_media    BOOLEAN NOT NULL DEFAULT false,
  upload_media  BOOLEAN NOT NULL DEFAULT false,
  edit_metadata BOOLEAN NOT NULL DEFAULT false,
  delete_media  BOOLEAN NOT NULL DEFAULT false,
  manage_roles  BOOLEAN NOT NULL DEFAULT false,
  create_tags   BOOLEAN NOT NULL DEFAULT false,
  manage_folders BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id      UUID REFERENCES public.roles(id),
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- MEDIA
-- -----------------------------------------------------------------------------
CREATE TABLE public.media (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  description    TEXT,
  media_type     TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  thumbnail_path TEXT,
  duration       INTEGER,
  recorded_at    TIMESTAMPTZ,
  uploaded_by    UUID NOT NULL REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TAG CATEGORIES
-- -----------------------------------------------------------------------------
CREATE TABLE public.tag_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- TAGS
-- -----------------------------------------------------------------------------
CREATE TABLE public.tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  category_id UUID NOT NULL REFERENCES public.tag_categories(id),
  is_folder   BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID NOT NULL REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, category_id)
);

-- -----------------------------------------------------------------------------
-- MEDIA TAGS
-- -----------------------------------------------------------------------------
CREATE TABLE public.media_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id   UUID NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES public.tags(id),
  start_time REAL,
  end_time   REAL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- WATCH PROGRESS
-- -----------------------------------------------------------------------------
CREATE TABLE public.watch_progress (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id),
  media_id   UUID NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, media_id)
);

-- =============================================================================
-- SEED DATA — Hardcoded roles
-- =============================================================================
INSERT INTO public.roles (name, view_media, upload_media, edit_metadata, delete_media, manage_roles, create_tags, manage_folders)
VALUES
  ('Owner',  true,  true,  true,  true,  true,  true,  true),
  ('Editor', true,  true,  true,  false, false, true,  false),
  ('Viewer', true,  false, false, false, false, false, false);

-- =============================================================================
-- PROFILE AUTO-CREATION TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  owner_role_id UUID;
  has_any_roles BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE role_id IS NOT NULL) INTO has_any_roles;

  IF NOT has_any_roles THEN
    SELECT id INTO owner_role_id FROM public.roles WHERE name = 'Owner' LIMIT 1;
    INSERT INTO public.profiles (id, display_name, role_id, created_at)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', owner_role_id, now());
  ELSE
    INSERT INTO public.profiles (id, display_name, created_at)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Helper function to check permission flag
-- (Used inline in policies for clarity; no separate function needed)

-- Helper: check if the current user has a specific permission flag.
-- SECURITY DEFINER bypasses RLS to avoid infinite recursion when profiles
-- policies need to check the requesting user's role.
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

-- Last-Owner protection helper
CREATE OR REPLACE FUNCTION public.is_last_owner(target_profile_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COUNT(*) <= 1
  FROM public.profiles p
  JOIN public.roles r ON p.role_id = r.id
  WHERE r.name = 'Owner'
$$ LANGUAGE sql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- RLS: roles
-- -----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_select_authenticated"
  ON public.roles FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "roles_insert_manage_roles"
  ON public.roles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('manage_roles')));

CREATE POLICY "roles_update_manage_roles"
  ON public.roles FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_roles')));

CREATE POLICY "roles_delete_manage_roles"
  ON public.roles FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_roles')));

-- -----------------------------------------------------------------------------
-- RLS: profiles
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: own profile OR has manage_roles
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR (SELECT public.user_has_permission('manage_roles'))
  );

-- UPDATE own display_name
CREATE POLICY "profiles_update_own_display_name"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- UPDATE role_id by someone with manage_roles (no self-change, no last-owner demotion)
CREATE POLICY "profiles_update_role_id"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    id != auth.uid()
    AND (SELECT public.user_has_permission('manage_roles'))
    AND NOT (
      -- Block if target is currently an Owner and is the last one
      EXISTS (
        SELECT 1 FROM public.roles r2
        WHERE r2.id = profiles.role_id AND r2.name = 'Owner'
      )
      AND public.is_last_owner(profiles.id)
    )
  );

-- -----------------------------------------------------------------------------
-- RLS: media
-- -----------------------------------------------------------------------------
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_select"
  ON public.media FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

CREATE POLICY "media_insert"
  ON public.media FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('upload_media')));

CREATE POLICY "media_update"
  ON public.media FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('edit_metadata')));

CREATE POLICY "media_delete"
  ON public.media FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR (SELECT public.user_has_permission('delete_media'))
  );

-- -----------------------------------------------------------------------------
-- RLS: tag_categories
-- -----------------------------------------------------------------------------
ALTER TABLE public.tag_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_categories_select"
  ON public.tag_categories FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

CREATE POLICY "tag_categories_insert"
  ON public.tag_categories FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('create_tags')));

-- -----------------------------------------------------------------------------
-- RLS: tags
-- -----------------------------------------------------------------------------
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select"
  ON public.tags FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

CREATE POLICY "tags_insert"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('create_tags')));

CREATE POLICY "tags_update_is_folder"
  ON public.tags FOR UPDATE
  TO authenticated
  USING ((SELECT public.user_has_permission('manage_folders')));

-- -----------------------------------------------------------------------------
-- RLS: media_tags
-- -----------------------------------------------------------------------------
ALTER TABLE public.media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_tags_select"
  ON public.media_tags FOR SELECT
  TO authenticated
  USING ((SELECT public.user_has_permission('view_media')));

CREATE POLICY "media_tags_insert"
  ON public.media_tags FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.user_has_permission('edit_metadata')));

CREATE POLICY "media_tags_delete"
  ON public.media_tags FOR DELETE
  TO authenticated
  USING ((SELECT public.user_has_permission('edit_metadata')));

-- -----------------------------------------------------------------------------
-- RLS: watch_progress
-- -----------------------------------------------------------------------------
ALTER TABLE public.watch_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watch_progress_select"
  ON public.watch_progress FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "watch_progress_insert"
  ON public.watch_progress FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "watch_progress_update"
  ON public.watch_progress FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
