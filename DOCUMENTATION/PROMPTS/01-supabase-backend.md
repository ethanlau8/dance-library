# Prompt 1 — Supabase Backend + Cloudflare Worker

## Context

We are building **Dance Library**, a private, role-gated web application for organizing and browsing dance videos. The full feature spec is in `DOCUMENTATION/feature-design.md`, data architecture in `DOCUMENTATION/data-architecture.md`.

**Tech stack:**
- Frontend: React SPA on GitHub Pages (not built yet)
- Auth & Database: Supabase (Postgres + Auth + Edge Functions)
- Media Storage: Cloudflare R2
- Thumbnail Serving: Cloudflare Worker (public, no auth)

---

## Task

Implement the entire backend layer:

1. Supabase database schema (SQL migration)
2. Row Level Security policies
3. Database trigger for profile auto-creation + first-user Owner bootstrapping
4. Seed data for the three hardcoded roles
5. All four Supabase Edge Functions
6. Cloudflare Worker for public thumbnail serving

---

## 1. Database Schema

Create a single SQL migration file at `supabase/migrations/<timestamp>_initial_schema.sql`.

### Tables to create (in dependency order):

**roles**
```
id UUID PK
name TEXT UNIQUE NOT NULL
view_media BOOLEAN NOT NULL DEFAULT false
upload_media BOOLEAN NOT NULL DEFAULT false
edit_metadata BOOLEAN NOT NULL DEFAULT false
delete_media BOOLEAN NOT NULL DEFAULT false
manage_roles BOOLEAN NOT NULL DEFAULT false
create_tags BOOLEAN NOT NULL DEFAULT false
manage_folders BOOLEAN NOT NULL DEFAULT false
created_at TIMESTAMPTZ DEFAULT now()
```

**profiles** (extends auth.users)
```
id UUID PK REFERENCES auth.users(id)
role_id UUID FK → roles.id (nullable)
display_name TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

**media**
```
id UUID PK DEFAULT gen_random_uuid()
title TEXT NOT NULL
description TEXT
media_type TEXT NOT NULL
storage_path TEXT NOT NULL
thumbnail_path TEXT
duration INTEGER
recorded_at TIMESTAMPTZ
uploaded_by UUID FK → profiles.id NOT NULL
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

**tag_categories**
```
id UUID PK DEFAULT gen_random_uuid()
name TEXT UNIQUE NOT NULL
created_by UUID FK → profiles.id NOT NULL
created_at TIMESTAMPTZ DEFAULT now()
```

**tags**
```
id UUID PK DEFAULT gen_random_uuid()
name TEXT NOT NULL
description TEXT
category_id UUID FK → tag_categories.id NOT NULL
is_folder BOOLEAN NOT NULL DEFAULT false
created_by UUID FK → profiles.id NOT NULL
created_at TIMESTAMPTZ DEFAULT now()
UNIQUE(name, category_id)
```

**media_tags**
```
id UUID PK DEFAULT gen_random_uuid()
media_id UUID FK → media.id ON DELETE CASCADE NOT NULL
tag_id UUID FK → tags.id NOT NULL
start_time REAL
end_time REAL
created_by UUID FK → profiles.id NOT NULL
created_at TIMESTAMPTZ DEFAULT now()
```

**watch_progress**
```
id UUID PK DEFAULT gen_random_uuid()
user_id UUID FK → profiles.id NOT NULL
media_id UUID FK → media.id ON DELETE CASCADE NOT NULL
position REAL NOT NULL
updated_at TIMESTAMPTZ DEFAULT now()
UNIQUE(user_id, media_id)
```

### Seed data

Insert the three hardcoded roles:

| name    | view | upload | edit | delete | manage_roles | create_tags | manage_folders |
|---------|------|--------|------|--------|--------------|-------------|----------------|
| Owner   | true | true   | true | true   | true         | true        | true           |
| Editor  | true | true   | true | false  | false        | true        | false          |
| Viewer  | true | false  | false| false  | false        | false       | false          |

---

## 2. Row Level Security

Enable RLS on all tables. Implement the following policies. All permission checks follow this pattern:

```sql
EXISTS (
  SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id
  WHERE p.id = auth.uid() AND r.<permission_flag> = true
)
```

### profiles
- SELECT: `auth.uid() = id` OR user has `manage_roles`
- UPDATE role_id: user has `manage_roles` AND `id != auth.uid()` AND not demoting last Owner
- UPDATE own display_name: `auth.uid() = id`

For the "last Owner" protection, use a check function:
```sql
CREATE OR REPLACE FUNCTION is_last_owner(target_profile_id UUID) RETURNS BOOLEAN AS $$
  SELECT COUNT(*) <= 1
  FROM profiles p JOIN roles r ON p.role_id = r.id
  WHERE r.name = 'Owner'
$$ LANGUAGE sql SECURITY DEFINER;
```
Block the UPDATE if the target user is currently an Owner and `is_last_owner(id)` is true.

### roles
- SELECT: any authenticated user (`auth.uid() IS NOT NULL`)
- INSERT/UPDATE/DELETE: user has `manage_roles` (deferred — no UI yet, but policy must exist)

### media
- SELECT: user has `view_media`
- INSERT: user has `upload_media`
- UPDATE: user has `edit_metadata`
- DELETE: user has `delete_media` OR `uploaded_by = auth.uid()`

### tag_categories
- SELECT: user has `view_media`
- INSERT: user has `create_tags`

### tags
- SELECT: user has `view_media`
- INSERT: user has `create_tags`
- UPDATE (is_folder only): user has `manage_folders`

### media_tags
- SELECT: user has `view_media`
- INSERT: user has `edit_metadata`
- DELETE: user has `edit_metadata`

### watch_progress
- SELECT: `user_id = auth.uid()`
- INSERT/UPDATE: `user_id = auth.uid()`

---

## 3. Profile Auto-Creation Trigger

```sql
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
```

---

## 4. Edge Functions

Create four Supabase Edge Functions in `supabase/functions/`. Each function must:
- Extract the JWT from the `Authorization: Bearer <token>` header
- Verify the user's permission by querying the database using the service role client
- Return appropriate HTTP error codes for auth failures (401) and permission failures (403)

Use the `@supabase/supabase-js` client initialized with the **service role key** (from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`) for all DB queries inside Edge Functions. Use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` for R2 operations (R2 is S3-compatible).

### get-upload-url

`POST /functions/v1/get-upload-url`

Request body: `{ filename: string, content_type: string, type: "video" | "image" | string }`

Logic:
1. Verify JWT, check `upload_media = true`
2. Generate a unique storage key for the media file: `videos/<uuid>.<ext>`
3. Generate a unique storage key for the thumbnail: `thumbs/<uuid>.jpg`
4. Create presigned PUT URLs for both using the R2 S3 API (15-minute expiry)
5. Return: `{ media_upload_url, media_storage_path, thumbnail_upload_url, thumbnail_storage_path }`

### create-media

`POST /functions/v1/create-media`

Request body:
```json
{
  "title": "string",
  "description": "string",
  "media_type": "string",
  "storage_path": "string",
  "thumbnail_path": "string",
  "duration": 272,
  "recorded_at": "ISO string or null",
  "tag_ids": ["uuid", ...]
}
```

Logic:
1. Verify JWT, check `upload_media = true`
2. Insert row into `media` table with `uploaded_by = auth.uid()`
3. Insert rows into `media_tags` for each tag_id (video-level, no timestamps)
4. Return: `{ media_id }`

### get-media-url

`GET /functions/v1/get-media-url?media_id=<uuid>`

Logic:
1. Verify JWT, check `view_media = true`
2. Look up `storage_path` from `media` table for the given `media_id`
3. Generate presigned GET URL with 1-hour expiry
4. Return: `{ url, expires_in: 3600 }`

### replace-media

`POST /functions/v1/replace-media`

Request body:
```json
{
  "media_id": "uuid",
  "new_storage_path": "string",
  "new_thumbnail_path": "string",
  "duration": 305,
  "recorded_at": "ISO string or null"
}
```

Logic:
1. Verify JWT, check `edit_metadata = true`
2. Read the current `storage_path` and `thumbnail_path` from `media` for this `media_id`
3. Update `media` row: new paths, duration, recorded_at, set `updated_at = now()`
4. Delete the old video file and old thumbnail from R2
5. Return: `{ success: true }`

---

## 5. Cloudflare Worker

Create the thumbnail-serving Worker at `cloudflare/thumbnail-worker/`.

**`wrangler.toml`:**
```toml
name = "dance-library-thumbs"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "dance-library"
```

**`src/index.ts`:**

The Worker receives GET requests for paths like `/thumbs/abc123.jpg`. It:
1. Strips the leading `/` from the URL path to get the R2 object key
2. Fetches the object from `env.BUCKET`
3. Returns the object body with the appropriate `Content-Type` header and cache headers (`Cache-Control: public, max-age=31536000`)
4. Returns 404 if the object does not exist

No authentication. Public access only.

---

## File Structure Expected

```
supabase/
  migrations/
    <timestamp>_initial_schema.sql
  functions/
    get-upload-url/
      index.ts
    create-media/
      index.ts
    get-media-url/
      index.ts
    replace-media/
      index.ts
cloudflare/
  thumbnail-worker/
    wrangler.toml
    src/
      index.ts
```

---

## Notes

- Do not create the React frontend yet — that is covered in subsequent prompts.
- The Edge Functions should use Deno (Supabase Edge Functions run on Deno).
- Add CORS headers to all Edge Functions to allow requests from the GitHub Pages origin (set `Access-Control-Allow-Origin: *` for now; tighten to the actual domain later).
- Handle OPTIONS preflight requests in each Edge Function.
