# Data Architecture

## 1. Overview

### Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | GitHub Pages (static SPA) | Hosts the web application |
| Auth & Database | Supabase | Authentication, Postgres database, Edge Functions |
| Media Storage | Cloudflare R2 | Stores video files, images, and thumbnails |
| Thumbnail Serving | Cloudflare Worker | Public, unauthenticated access to thumbnails |
| Thumbnail Generation | ffmpeg.wasm (client-side) | Extracts thumbnails from video files in the browser |

### Architecture diagram

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                          │
│                (GitHub Pages SPA)                     │
│                                                     │
│   Supabase JS Client ──── Auth + DB queries (RLS)   │
│   fetch() ──── Edge Functions (video URL, upload)   │
│   <img src> ──── Cloudflare Worker (thumbnails)     │
│   ffmpeg.wasm ──── Client-side thumbnail gen        │
└────────┬─────────────────┬──────────────┬───────────┘
         │                 │              │
         ▼                 ▼              ▼
┌─────────────┐  ┌─────────────────┐  ┌──────────────┐
│  Supabase   │  │  Supabase Edge  │  │  Cloudflare  │
│  Auth + DB  │  │  Functions      │  │              │
│             │  │                 │  │  Worker      │
│  - auth     │  │  - get-upload-  │  │  (thumbnails)│
│  - profiles │  │    url          │  │              │
│  - media    │  │  - create-media │  │  R2 Bucket   │
│  - tags     │  │  - get-media-   │  │  - /videos   │
│  - RLS      │  │    url          │  │  - /thumbs   │
│             │  │  - replace-     │  │              │
│             │  │    media        │  │              │
└─────────────┘  └─────────────────┘  └──────────────┘
```

---

## 2. Database Schema

All tables live in the `public` schema in Supabase Postgres. Supabase's built-in `auth.users` table handles authentication. All `id` columns use UUID v4. All timestamps use `TIMESTAMPTZ`.

### profiles

Extends `auth.users` with application-specific data. Created automatically via a database trigger when a user signs up.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, references `auth.users.id` | User ID (matches Supabase auth) |
| `role_id` | UUID | FK → `roles.id`, nullable | Assigned role. Null = no access. |
| `display_name` | TEXT | | User's display name |
| `created_at` | TIMESTAMPTZ | default `now()` | When the profile was created |

### roles

Defines roles with boolean permission flags. Initially populated with three hardcoded roles (Owner, Editor, Viewer).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Role ID |
| `name` | TEXT | UNIQUE, NOT NULL | Role display name |
| `view_media` | BOOLEAN | NOT NULL, default `false` | Can browse and watch media |
| `upload_media` | BOOLEAN | NOT NULL, default `false` | Can upload new media |
| `edit_metadata` | BOOLEAN | NOT NULL, default `false` | Can edit title, description, apply/remove tags |
| `delete_media` | BOOLEAN | NOT NULL, default `false` | Can delete media |
| `manage_roles` | BOOLEAN | NOT NULL, default `false` | Can assign and change user roles |
| `create_tags` | BOOLEAN | NOT NULL, default `false` | Can create new tags and tag categories |
| `manage_folders` | BOOLEAN | NOT NULL, default `false` | Can toggle `is_folder` on tags |
| `created_at` | TIMESTAMPTZ | default `now()` | When the role was created |

### media

Stores metadata for all uploaded media. The actual files live in R2.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Media ID |
| `title` | TEXT | NOT NULL | Display title |
| `description` | TEXT | | Optional description |
| `media_type` | TEXT | NOT NULL | Type of media (e.g., `video`, `image`) |
| `storage_path` | TEXT | NOT NULL | R2 object key for the media file |
| `thumbnail_path` | TEXT | | R2 object key for the thumbnail |
| `duration` | INTEGER | | Duration in seconds (null for non-video) |
| `recorded_at` | TIMESTAMPTZ | | When the media was recorded (from file metadata) |
| `uploaded_by` | UUID | FK → `profiles.id`, NOT NULL | User who uploaded the media |
| `created_at` | TIMESTAMPTZ | default `now()` | Upload timestamp |
| `updated_at` | TIMESTAMPTZ | default `now()` | Last metadata update |

### tag_categories

Groupings for tags (e.g., Style, Move, Difficulty).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Category ID |
| `name` | TEXT | UNIQUE, NOT NULL | Category display name |
| `created_by` | UUID | FK → `profiles.id`, NOT NULL | User who created the category |
| `created_at` | TIMESTAMPTZ | default `now()` | When the category was created |

### tags

Reusable labels applied to media.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Tag ID |
| `name` | TEXT | NOT NULL | Tag display name |
| `description` | TEXT | | Optional description of the tag |
| `category_id` | UUID | FK → `tag_categories.id`, NOT NULL | Category this tag belongs to |
| `is_folder` | BOOLEAN | NOT NULL, default `false` | Whether this tag appears as a navigable folder |
| `created_by` | UUID | FK → `profiles.id`, NOT NULL | User who created the tag |
| `created_at` | TIMESTAMPTZ | default `now()` | When the tag was created |

**Constraints:** `UNIQUE(name, category_id)` — tag names must be unique within a category but can be reused across categories.

### media_tags

Junction table linking tags to media, with optional time ranges for timestamp tags.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Application ID |
| `media_id` | UUID | FK → `media.id`, ON DELETE CASCADE, NOT NULL | The media item |
| `tag_id` | UUID | FK → `tags.id`, NOT NULL | The tag being applied |
| `start_time` | REAL | | Start of the tagged range in seconds (null = video-level tag) |
| `end_time` | REAL | | End of the tagged range in seconds (null = video-level tag) |
| `created_by` | UUID | FK → `profiles.id`, NOT NULL | User who applied the tag |
| `created_at` | TIMESTAMPTZ | default `now()` | When the tag was applied |

**Notes:**
- If both `start_time` and `end_time` are null, this is a video-level tag.
- If both are populated, this is a timestamp tag marking a specific range.
- The same `tag_id` + `media_id` combination can appear multiple times with different time ranges.
- `ON DELETE CASCADE` on `media_id` ensures tag applications are cleaned up when media is deleted.

### watch_progress

Tracks per-user, per-video playback position for the Continue Watching feature.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | Record ID |
| `user_id` | UUID | FK → `profiles.id`, NOT NULL | The user |
| `media_id` | UUID | FK → `media.id`, ON DELETE CASCADE, NOT NULL | The media item |
| `position` | REAL | NOT NULL | Playback position in seconds |
| `updated_at` | TIMESTAMPTZ | default `now()` | Last time the position was saved |

**Constraints:** `UNIQUE(user_id, media_id)` — one progress record per user per media item. Updates are upserts.

### Client-side storage (localStorage)

The following data is stored in the browser's localStorage rather than in the database:

| Key | Description |
|---|---|
| View preference | Grid (A) or feed (D) toggle state |
| Recent searches | List of recent search queries |

---

## 3. Entity Relationships

### ER diagram

```
auth.users
    │
    │ 1:1
    ▼
profiles ──────── many:1 ──────── roles
    │                              (permission flags)
    │
    ├─── 1:many ───▶ media
    │                  │
    │                  │ 1:many
    │                  ▼
    │              media_tags ◀── many:1 ── tags
    │                                        │
    │                                        │ many:1
    │                                        ▼
    │                                   tag_categories
    │
    └─── 1:many ───▶ watch_progress ◀── many:1 ── media
```

### Relationship descriptions

| Relationship | Type | Description |
|---|---|---|
| `auth.users` → `profiles` | 1:1 | Every auth user has exactly one profile, created via trigger |
| `profiles` → `roles` | Many:1 | Many users can share the same role. A user has zero or one role. |
| `profiles` → `media` | 1:Many | A user can upload many media items |
| `media` → `media_tags` | 1:Many | A media item can have many tag applications |
| `tags` → `media_tags` | 1:Many | A tag can be applied to many media items (and multiple times to the same item) |
| `tags` → `tag_categories` | Many:1 | A tag belongs to exactly one category |
| `profiles` → `media_tags` | 1:Many | Tracks who applied each tag |
| `profiles` → `watch_progress` | 1:Many | A user has progress records for many media items |
| `media` → `watch_progress` | 1:Many | A media item has progress records from many users |
| `profiles` → `tags` | 1:Many | Tracks who created each tag |
| `profiles` → `tag_categories` | 1:Many | Tracks who created each category |

---

## 4. Row Level Security (RLS)

All tables have RLS enabled. Policies resolve permissions by joining the requesting user's profile to their role and checking the relevant boolean flag.

### Permission resolution

Every RLS policy follows this pattern to determine the user's permissions:

```sql
-- Get the requesting user's permissions
SELECT r.*
FROM roles r
JOIN profiles p ON p.role_id = r.id
WHERE p.id = auth.uid()
```

If the user has no profile or no role (`role_id` is null), no permissions are granted and all queries return empty results.

### Policies by table

#### profiles

| Operation | Policy |
|---|---|
| SELECT | Users can read their own profile. Users with `manage_roles` can read all profiles. |
| UPDATE (`role_id`) | Only users with `manage_roles` can update another user's `role_id`. Additional constraints: a user cannot update their own `role_id` (no self-role-change), and the last user with the Owner role cannot have their `role_id` changed (minimum one Owner). |
| UPDATE (own profile) | Users can update their own `display_name`. |

#### roles

| Operation | Policy |
|---|---|
| SELECT | Any authenticated user can read roles (needed to resolve permissions). |
| INSERT / UPDATE / DELETE | Only users with `manage_roles` (deferred — no UI for custom roles yet). |

#### media

| Operation | Policy |
|---|---|
| SELECT | Users with `view_media` can read all media. |
| INSERT | Users with `upload_media` can insert. |
| UPDATE | Users with `edit_metadata` can update. |
| DELETE | Users with `delete_media` can delete any media. Additionally, the user who uploaded the media (`uploaded_by = auth.uid()`) can always delete their own, regardless of role. |

#### tag_categories

| Operation | Policy |
|---|---|
| SELECT | Users with `view_media` can read all categories. |
| INSERT | Users with `create_tags` can insert. |

#### tags

| Operation | Policy |
|---|---|
| SELECT | Users with `view_media` can read all tags. |
| INSERT | Users with `create_tags` can insert. |
| UPDATE (`is_folder`) | Users with `manage_folders` can update. |

#### media_tags

| Operation | Policy |
|---|---|
| SELECT | Users with `view_media` can read all tag applications. |
| INSERT | Users with `edit_metadata` can insert. |
| DELETE | Users with `edit_metadata` can delete. |

#### watch_progress

| Operation | Policy |
|---|---|
| SELECT | Users can only read their own progress records. |
| INSERT / UPDATE | Users can only upsert their own progress records. |
| DELETE | Cascades from media deletion. |

---

## 5. Authentication Flow

### Supabase Auth setup

Authentication uses Supabase Auth with email and password. No OAuth providers, no magic links — simple email/password signup and login.

### Profile auto-creation trigger

A Postgres trigger automatically creates a `profiles` row when a new user signs up. If no users with an assigned role exist yet (bootstrapping), the new user is automatically assigned the Owner role:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  owner_role_id UUID;
  has_any_roles BOOLEAN;
BEGIN
  -- Check if any profiles have a role assigned
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE role_id IS NOT NULL) INTO has_any_roles;

  -- If no one has a role yet, this is the first user — assign Owner
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

For subsequent signups, the new profile has `role_id = null`, which means no access until the owner assigns a role.

### JWT and session handling

1. User signs up or logs in via the Supabase JS client.
2. Supabase returns a JWT containing the user's `auth.uid()`.
3. The Supabase JS client automatically attaches this JWT to all subsequent database queries and Edge Function calls.
4. RLS policies use `auth.uid()` to resolve the user's profile and permissions.
5. Edge Functions extract the JWT from the `Authorization` header to verify identity.

Session tokens are managed by the Supabase JS client library (stored in localStorage, automatically refreshed).

---

## 6. Edge Functions

Four Supabase Edge Functions handle operations that require server-side logic or access to R2 credentials. All other operations (reads, metadata edits, tag management, role assignment, watch progress) go through the Supabase JS client directly with RLS enforcement.

### DB vs Edge Function boundary

The rule is simple: **anything that touches R2 goes through an edge function** (because R2 credentials must stay server-side). Everything else goes through the Supabase JS client with RLS.

| Operation | Channel | Reason |
|---|---|---|
| Read media, tags, profiles, etc. | Supabase JS client | RLS enforces permissions |
| Edit metadata (title, desc, tags) | Supabase JS client | RLS enforces `edit_metadata` |
| Create tags / categories | Supabase JS client | RLS enforces `create_tags` |
| Toggle `is_folder` on tags | Supabase JS client | RLS enforces `manage_folders` |
| Assign roles | Supabase JS client | RLS enforces `manage_roles` |
| Upsert watch progress | Supabase JS client | RLS enforces user-own-records |
| Upload file to R2 | Edge Function | Needs R2 secret key for presigned URL |
| Create media record after upload | Edge Function | Groups with upload flow for atomicity |
| Get video playback URL | Edge Function | Needs R2 secret key for presigned URL |
| Replace video file | Edge Function | Needs R2 secret key for presigned URL + old file deletion |

### get-upload-url

Generates presigned PUT URLs for uploading files directly to R2 from the browser.

| Attribute | Value |
|---|---|
| **Method** | POST |
| **Auth** | JWT required |
| **Permission check** | User's role must have `upload_media = true` |

**Request body:**

```json
{
  "filename": "video.mp4",
  "content_type": "video/mp4",
  "type": "video"
}
```

**Response:**

```json
{
  "media_upload_url": "https://r2.example.com/videos/abc123?X-Amz-Signature=...",
  "media_storage_path": "videos/abc123.mp4",
  "thumbnail_upload_url": "https://r2.example.com/thumbs/abc123?X-Amz-Signature=...",
  "thumbnail_storage_path": "thumbs/abc123.jpg"
}
```

**Flow:**
1. Validates the JWT and checks `upload_media` permission.
2. Generates a unique storage key for the media file and thumbnail.
3. Creates presigned PUT URLs for both using the R2 S3-compatible API.
4. Returns the URLs and storage paths to the frontend.

### create-media

Writes the media metadata and initial tags to the database after a successful upload.

| Attribute | Value |
|---|---|
| **Method** | POST |
| **Auth** | JWT required |
| **Permission check** | User's role must have `upload_media = true` |

**Request body:**

```json
{
  "title": "Cross-Body Lead Tutorial",
  "description": "Workshop footage from...",
  "media_type": "video",
  "storage_path": "videos/abc123.mp4",
  "thumbnail_path": "thumbs/abc123.jpg",
  "duration": 272,
  "recorded_at": "2025-03-15T00:00:00Z",
  "tag_ids": ["uuid-1", "uuid-2"]
}
```

**Response:**

```json
{
  "media_id": "uuid-new-media"
}
```

**Flow:**
1. Validates the JWT and checks `upload_media` permission.
2. Inserts a row into the `media` table.
3. Inserts rows into `media_tags` for each initial tag (video-level, no timestamps).
4. Returns the new media ID.

### get-media-url

Generates a presigned GET URL for accessing a video file from R2.

| Attribute | Value |
|---|---|
| **Method** | GET |
| **Auth** | JWT required |
| **Permission check** | User's role must have `view_media = true` |
| **Query param** | `media_id` |

**Response:**

```json
{
  "url": "https://r2.example.com/videos/abc123?X-Amz-Signature=...",
  "expires_in": 3600
}
```

**Flow:**
1. Validates the JWT and checks `view_media` permission.
2. Looks up the `storage_path` from the `media` table for the given `media_id`.
3. Generates a presigned GET URL with a 1-hour expiry.
4. Returns the URL to the frontend.
5. The frontend sets this URL as the video element's `src`.

### replace-media

Replaces a video file for an existing media item. Updates the database record and deletes the old files from R2.

| Attribute | Value |
|---|---|
| **Method** | POST |
| **Auth** | JWT required |
| **Permission check** | User's role must have `edit_metadata = true` |

**Request body:**

```json
{
  "media_id": "uuid-existing-media",
  "new_storage_path": "videos/xyz789.mp4",
  "new_thumbnail_path": "thumbs/xyz789.jpg",
  "duration": 305,
  "recorded_at": "2025-03-20T00:00:00Z"
}
```

**Response:**

```json
{
  "success": true
}
```

**Flow:**
1. Validates the JWT and checks `edit_metadata` permission.
2. Reads the existing `storage_path` and `thumbnail_path` from the `media` table for the given `media_id`.
3. Updates the `media` row with the new `storage_path`, `thumbnail_path`, `duration`, `recorded_at`, and `updated_at`.
4. Deletes the old video file and old thumbnail from R2.
5. Returns success.

**Note:** The frontend first calls `get-upload-url` to get presigned PUT URLs, uploads the new files directly to R2, then calls `replace-media` to update the database and clean up old files.

---

## 7. Cloudflare Worker

### Thumbnail serving

A Cloudflare Worker provides public, unauthenticated access to thumbnail images stored in R2. Thumbnails do not require auth because they contain no sensitive content and need to load quickly in the browse grid.

**Request:**
```
GET https://thumbs.yourdomain.com/thumbs/abc123.jpg
```

**Flow:**
1. Worker receives the request.
2. Fetches the object from the R2 bucket using the path.
3. Returns the image with appropriate cache headers.

No JWT, no permission check. Public access.

### R2 bucket structure

A single R2 bucket with two prefixes:

```
r2-bucket/
├── videos/          ← Video and media files (private, accessed via presigned URLs)
│   ├── abc123.mp4
│   ├── def456.mp4
│   └── ...
└── thumbs/          ← Thumbnail images (public, accessed via Cloudflare Worker)
    ├── abc123.jpg
    ├── def456.jpg
    └── ...
```

- **videos/**: Only accessible via presigned URLs generated by the `get-media-url` Edge Function.
- **thumbs/**: Publicly accessible via the Cloudflare Worker.

---

## 8. Key Queries

### Home screen — All Videos grid

```sql
-- Sort by upload date (default)
SELECT id, title, thumbnail_path, media_type, recorded_at, created_at
FROM media
ORDER BY created_at DESC;

-- Sort by recorded date
SELECT id, title, thumbnail_path, media_type, recorded_at, created_at
FROM media
ORDER BY COALESCE(recorded_at, created_at) DESC;

-- Sort alphabetically
SELECT id, title, thumbnail_path, media_type, recorded_at, created_at
FROM media
ORDER BY title ASC;
```

### Home screen — Folders row

```sql
SELECT t.id, t.name, COUNT(mt.media_id) AS video_count
FROM tags t
JOIN media_tags mt ON t.id = mt.tag_id
WHERE t.is_folder = true
GROUP BY t.id, t.name
ORDER BY t.name;
```

### Home screen — Continue Watching

```sql
SELECT m.id, m.title, m.thumbnail_path, m.duration, wp.position, wp.updated_at
FROM watch_progress wp
JOIN media m ON wp.media_id = m.id
WHERE wp.user_id = auth.uid()
  AND m.media_type = 'video'
  AND wp.position > 0
  AND wp.position < m.duration
ORDER BY wp.updated_at DESC
LIMIT 10;
```

### Folder view (e.g., Bachata)

```sql
SELECT m.id, m.title, m.thumbnail_path, m.recorded_at, m.created_at
FROM media m
JOIN media_tags mt ON m.id = mt.media_id
WHERE mt.tag_id = '<folder_tag_id>'
GROUP BY m.id
ORDER BY m.created_at DESC;
```

### Video detail — tags and timestamps

```sql
SELECT mt.id, mt.start_time, mt.end_time,
       t.id AS tag_id, t.name AS tag_name, t.description AS tag_description,
       tc.name AS category_name
FROM media_tags mt
JOIN tags t ON mt.tag_id = t.id
JOIN tag_categories tc ON t.category_id = tc.id
WHERE mt.media_id = '<media_id>'
ORDER BY mt.start_time NULLS FIRST, t.name;
```

### Search — full-text

```sql
SELECT m.id, m.title, m.thumbnail_path, m.recorded_at
FROM media m
WHERE m.title ILIKE '%query%'
   OR m.description ILIKE '%query%'
   OR m.id IN (
     SELECT mt.media_id
     FROM media_tags mt
     JOIN tags t ON mt.tag_id = t.id
     WHERE t.name ILIKE '%query%'
   )
ORDER BY m.created_at DESC;
```

**Note:** For better performance at scale, this can be upgraded to Postgres full-text search using `tsvector` and `tsquery` with a GIN index.

### Search — matching tags

```sql
SELECT id, name, category_id
FROM tags
WHERE name ILIKE '%query%'
ORDER BY name;
```

### Filter — multiple tags (AND logic)

```sql
SELECT m.id, m.title, m.thumbnail_path, m.recorded_at
FROM media m
JOIN media_tags mt ON m.id = mt.media_id
WHERE mt.tag_id IN ('<tag_id_1>', '<tag_id_2>')
GROUP BY m.id
HAVING COUNT(DISTINCT mt.tag_id) = 2
ORDER BY m.created_at DESC;
```

The `HAVING COUNT(DISTINCT mt.tag_id) = N` must match the number of tags in the filter to enforce AND logic.

### Filter — date range

```sql
SELECT id, title, thumbnail_path, recorded_at, created_at
FROM media
WHERE COALESCE(recorded_at, created_at) >= '<from_date>'
  AND COALESCE(recorded_at, created_at) <= '<to_date>'
ORDER BY COALESCE(recorded_at, created_at) DESC;
```

Uses `COALESCE(recorded_at, created_at)` to fall back to upload date when recorded date is not set. Date range filters can be combined with tag filters by adding the `WHERE` clauses together.

### Delete media

```sql
-- RLS policy allows deletion if:
--   user's role has delete_media = true
--   OR media.uploaded_by = auth.uid()

DELETE FROM media WHERE id = '<media_id>';
-- CASCADE automatically removes related media_tags and watch_progress rows
-- R2 file deletion is handled by the application layer (or a future edge function)
```

### Upsert watch progress

```sql
INSERT INTO watch_progress (id, user_id, media_id, position, updated_at)
VALUES (gen_random_uuid(), auth.uid(), '<media_id>', <position>, now())
ON CONFLICT (user_id, media_id)
DO UPDATE SET position = EXCLUDED.position, updated_at = now();
```

---

## 9. Design Decisions & Rationale

### Permission flags on the roles table instead of a junction table

The roles table stores permission flags as boolean columns directly rather than using a separate `role_permissions` junction table. With only 7 permission flags and 3 hardcoded roles, a junction table adds schema complexity (an extra table, extra joins in every RLS policy) with no benefit. If the system grows to dozens of permissions or fully dynamic role creation, migrating to a junction table is straightforward.

### No soft deletes

When media is deleted, it is permanently removed from R2 and the database. There is no soft delete, trash, or archive mechanism. For a personal archive with a small group of users, the complexity of soft deletes (filtering out "deleted" records in every query, storage costs for orphaned files, UI for restoration) outweighs the benefit. If the file is needed later, the user likely has the original locally.

### UNIQUE(name, category_id) on tags

Tag names are unique within a category but not globally. This allows the same word to exist in different contexts (e.g., "basic" as a Difficulty tag and "basic" as a Move tag) without collision, while preventing duplicate tags within the same category.

### Presigned URLs instead of proxying video bytes

Video files are served via presigned R2 URLs rather than streaming bytes through an Edge Function. Edge Functions have response size limits and execution time limits that make proxying large video files (up to several hundred MB) impractical. Presigned URLs allow the browser to download directly from R2 with no middleman, while still enforcing access control (the URL is only generated after permission is verified and it expires after 1 hour).

### localStorage for preferences and recent searches

View toggle preference (grid vs feed) and recent search queries are stored in the browser's localStorage rather than in the database. This data is user-device-specific, low-value, and does not need to sync across devices. Keeping it client-side avoids unnecessary database writes and schema complexity.

### Text field for media_type instead of enum

The `media_type` column uses a TEXT field rather than a Postgres ENUM. This allows new media types to be supported without a database migration. For a small-scale application, the storage overhead of TEXT vs ENUM is negligible.

### ON DELETE CASCADE on media_tags and watch_progress

When a media item is deleted, all associated tag applications (`media_tags`) and watch progress records (`watch_progress`) are automatically deleted via CASCADE. This prevents orphaned records and ensures cleanup is atomic with the media deletion.
