# Feature Design

## 1. Overview

Dance Library is a private, role-gated web application for organizing and browsing dance videos and other media. It serves as a personal archive where a small invited group can upload, tag, search, and watch dance content — with a tagging system that supports timestamped markers for jumping to specific moments within a video.

### Who it's for

A small group of people (e.g., dance partners, students, practice groups) managed by a single owner. The owner controls who has access and what they can do.

### Problem it solves

Dance videos end up scattered across phones, cloud drives, and messaging apps with no way to organize, tag, or search them. Finding a specific move or moment in a video means scrubbing through footage manually. Dance Library provides a centralized, searchable, tagged catalog with timestamp-level navigation.

### Tech stack

- **Frontend:** Static SPA hosted on GitHub Pages
- **Auth & Database:** Supabase (authentication, Postgres database, Edge Functions)
- **Media Storage:** Cloudflare R2
- **Thumbnail Serving:** Cloudflare Worker (public access, no auth)
- **Thumbnail Generation:** Client-side via ffmpeg.wasm

---

## 2. Access & Authentication

### Public signup

Anyone can create an account using email and password via Supabase Auth. There are no invite codes or restricted registration.

### Role-gated access

A newly created account has no role assigned. Users without a role see an empty state with a message:

> "Your account has been created. Let the site owner know so they can give you access."

No navigation, no content, and no functionality is available — only a log out option. The user must contact the owner through their own means (text, email, in person, etc.). There is no in-app notification system for the owner.

### Bootstrapping (first Owner)

When the very first user signs up, there is no Owner to assign roles. The system handles this automatically: a database trigger checks whether any profiles with an assigned role exist. If none do, the new signup is automatically assigned the Owner role. All subsequent signups follow the normal flow (no role until manually assigned).

### How users get access

The owner sees pending users (accounts with no role) in the Admin screen and assigns them a role. Once a role is assigned, the user sees whatever that role permits on their next visit.

---

## 3. Permissions

### Model

Each user has exactly one role. Roles are defined by a set of boolean permission flags. A user's permissions are determined entirely by their assigned role.

### Permission flags

| Flag | Description |
|---|---|
| `view_media` | Can browse and watch media in the catalog |
| `upload_media` | Can upload new media files |
| `edit_metadata` | Can edit title, description, and apply/remove existing tags on any media |
| `delete_media` | Can delete any media from the catalog (uploaders can always delete their own regardless of this flag) |
| `manage_roles` | Can assign and change roles for other users |
| `create_tags` | Can create new tags and new tag categories |
| `manage_folders` | Can toggle the `is_folder` flag on tags |

### Hardcoded roles

The platform ships with three fixed roles. The underlying schema supports custom roles, but the UI for creating/editing roles is deferred.

| Permission | Owner | Editor | Viewer |
|---|---|---|---|
| `view_media` | Yes | Yes | Yes |
| `upload_media` | Yes | Yes | No |
| `edit_metadata` | Yes | Yes | No |
| `delete_media` | Yes | No | No |
| `manage_roles` | Yes | No | No |
| `create_tags` | Yes | Yes | No |
| `manage_folders` | Yes | No | No |

### Owner protection

Two rules protect the system from accidental lockout:

1. **No self-role-change:** A user cannot change their own role. This prevents the Owner from accidentally demoting themselves.
2. **Minimum one Owner:** The last user with the Owner role cannot be demoted. There must always be at least one Owner in the system.

Ownership transfer works by assigning the Owner role to another user first. That new Owner can then change the original Owner's role. Multiple Owners are allowed.

### Enforcement

Permissions are enforced at two levels:

- **Database level:** Supabase Row Level Security (RLS) policies on every table ensure that even if the frontend is bypassed, unauthorized actions are blocked.
- **Frontend level:** The UI hides or disables controls the user doesn't have permission for (e.g., the upload button is hidden for Viewers, the edit button is hidden for users without `edit_metadata`).

---

## 4. Media Management

### Supported media types

Any media type can be uploaded (video, image, etc.). Videos are the primary content type. The platform does not transcode or re-encode media — files are stored and served in their original format.

### Upload flow

1. The user selects a file (or drags and drops on desktop).
2. If the file is a video, the browser generates a thumbnail using ffmpeg.wasm. This runs client-side with no server-side processing.
3. The frontend requests a presigned PUT URL from the `get-upload-url` Edge Function.
4. The browser uploads the file directly to Cloudflare R2 using the presigned URL.
5. The browser uploads the generated thumbnail to R2 (via a second presigned URL).
6. The frontend calls the `create-media` Edge Function with the metadata (title, description, recorded date, storage keys, initial tags).
7. The Edge Function writes the media record and tag applications to the database.

### Recorded date

The recorded date is automatically extracted from the video file's metadata (e.g., EXIF/MP4 creation date) client-side during thumbnail generation. If the metadata is missing or incorrect, the user can manually set or override the recorded date. Upload date is always captured separately and automatically.

### Editing

Users with `edit_metadata` permission can edit:

- Title
- Description
- Recorded date
- Tags (add/remove existing tags, add timestamp tags)

Editing happens inline on the video detail page — the page transforms into an editable state with Save/Cancel controls.

### Replacing video files

A video file can be replaced with a new upload. This re-uploads the file to R2 and regenerates the thumbnail. The media record (and all its tags/timestamps) is preserved. There is no version history — the old file is deleted.

### Deleting media

A user can delete a media item if their role has `delete_media` permission OR if they are the user who uploaded it. Deletion is permanent — the file is removed from R2 and the database record (along with all tag applications and watch progress) is deleted. There is no soft delete or trash.

---

## 5. Tagging System

### Tag model

A tag is a reusable label with the following attributes:

| Attribute | Description |
|---|---|
| Name | The display name (e.g., "cross-body lead", "bachata") |
| Category | The tag category it belongs to (e.g., Style, Move, Difficulty) |
| Description | An optional description explaining the tag (e.g., what a move is) |
| Creator | The user who created the tag |
| Is Folder | Whether this tag generates a navigable folder in the UI |

### Tag categories

Tag categories are groupings like "Style," "Move," "Difficulty," or "Artist." Categories are user-created — anyone with the `create_tags` permission can create new categories. A tag must belong to exactly one category. Two tags can share the same name if they belong to different categories, but within a category, tag names are unique.

### Tag application

Tags are applied to media through a junction that supports optional time ranges:

- **Video-level tag:** A tag applied to a video with no time range. Describes the video as a whole (e.g., "bachata," "intermediate").
- **Timestamped tag:** A tag applied with a `start_time` and `end_time` (in seconds). Marks a specific moment or section in the video (e.g., "cross-body lead" from 0:32 to 0:48).

The same tag can be applied to the same video multiple times with different time ranges. For example, if a cross-body lead is performed three times in a video, the "cross-body lead" tag can appear at three different timestamp ranges.

When displaying a video's tags (e.g., for filtering or on the grid), the list is deduplicated — the video is shown as having the tag regardless of how many timestamp placements exist.

### Tag creation vs. tag application

These are separate permissions:

- **`create_tags`**: Create new tags and new tag categories. This is about expanding the vocabulary.
- **`edit_metadata`**: Apply existing tags to videos, remove tag applications, and set timestamp ranges. This is about labeling content.

A user with `edit_metadata` but not `create_tags` can tag videos using existing tags but cannot introduce new ones. This prevents tag sprawl from users who shouldn't be defining the taxonomy.

### Tag deletion

Tags cannot be deleted. Once a tag exists, it exists permanently. Individual tag applications (a specific tag on a specific video, optionally at a specific time range) can be removed by users with `edit_metadata` permission.

### Tag-folders

Any tag can be flagged as a "folder" by a user with the `manage_folders` permission. A folder-tag generates a navigable entry point in the UI:

- Folder-tags appear in the Folders row on the home screen.
- Tapping a folder opens a filtered view showing all videos that have that tag.
- A video can have multiple folder-tags and will appear in all corresponding folders.
- Folders are not exclusive containers — they are shortcut filtered views.
- There is no nesting or hierarchy. Each folder is a flat, single-tag filter.

---

## 6. Browsing & Navigation

### Home screen

The home screen has four sections, top to bottom:

1. **Search bar** — Always visible at the top. Tapping opens a full-screen search overlay.
2. **Continue Watching** — Horizontal scrollable row of videos the user has partially watched, showing the thumbnail with a progress indicator. Most recently watched first.
3. **Folders** — Horizontal scrollable row of folder-tag icons with video counts. Tapping a folder opens its filtered view.
4. **All Videos grid** — The complete media catalog. Supports two view modes toggled by the user.

### View toggle (A/D)

The video grid supports two view modes:

- **Grid view (A):** Instagram-style 3-column tight thumbnail grid. Minimal/no spacing between cells, thin borders. No title or tags visible — pure visual browsing. Tapping a thumbnail opens the detail page.
- **Feed view (D):** Single-column feed with full-width thumbnails. Title, tags, and date visible below each thumbnail. Maximum detail per item, one video per row.

A toggle control in the "All Videos" header switches between the two views. The user's preference is persisted in localStorage.

### Shareable URLs

Every video and folder has a stable, shareable URL:

- Videos: `/video/{id}`
- Folders: `/folder/{tag_id}`

Sharing a URL with someone who has an account and an assigned role takes them directly to that page. Users without auth or without a role are redirected to the login screen or empty state respectively.

### Folder view

Tapping a folder from the home screen opens a scoped view:

- Back arrow returns to the home screen.
- Search bar is scoped to videos within this folder.
- The same A/D view toggle is available.
- The same filter panel is available for further narrowing (e.g., all beginner bachata videos).
- The folder view is functionally identical to the home grid with a pre-applied tag filter.

### Videos in multiple folders

A video tagged with multiple folder-tags (e.g., "bachata" and "workshop") appears in both folders. Folders are filtered views, not exclusive containers.

---

## 7. Search & Filtering

### Full-text search

The search bar provides live, as-you-type results across:

- Media titles
- Media descriptions
- Tag names

Results are split into two sections:

- **Videos** — Matching media items shown with thumbnail, title, and tags.
- **Tags** — Matching tag names shown as chips. Tapping a tag applies it as a filter on the home grid.

Tapping a video result opens its detail page. Search results are video-level only — timestamp-level matches are not surfaced in search.

### Recent searches

The search overlay shows a list of recent search queries below the search bar. Recent searches are stored client-side in localStorage.

### Tag filtering

The filter panel (bottom sheet on mobile) allows filtering by tags, organized by category:

- Each tag category is a section (e.g., Style, Difficulty, Move).
- Within each section, tags are displayed as selectable chips.
- Multiple tags can be selected within and across categories.
- Filtering uses AND logic — selecting "bachata" and "intermediate" shows only videos that have both tags.
- Active filters are displayed as chips above the video grid after the filter panel is closed. Chips can be tapped to remove individual filters.

### Date range filtering

The filter panel includes a date range picker that filters by recorded date. If a video has no recorded date (metadata was missing and not manually set), its upload date is used as a fallback. Both a "from" and "to" date can be set, or just one for an open-ended range.

### Sort options

The video grid can be sorted by three criteria:

- **Upload date** (newest first) — the default sort
- **Recorded date** (newest first) — useful for finding recently filmed content when videos are uploaded in batches
- **Alphabetical** — sort by title A-Z

### Filter persistence

Active filters persist within the browser session. Navigating to a video detail page and returning to the grid preserves the applied filters. Filters reset when the browser tab is closed.

### Pagination

The video grid uses infinite scroll. More videos are loaded automatically as the user scrolls near the bottom of the grid.

---

## 8. Video Playback

### Lazy loading

Videos are not loaded in the grid or feed views. Only static thumbnails are displayed. The actual video file is loaded only when the user opens the detail page. This is done by requesting a presigned URL from the `get-media-url` Edge Function.

### Timeline markers

The video player's progress bar displays visual markers (small indicators) at the positions corresponding to each timestamp tag's `start_time`. These markers provide a visual overview of where tagged moments occur in the video.

### Timestamp navigation

Below the video player, timestamp tags are listed with their time ranges and tag names. Tapping a timestamp row jumps the video to that position. The video player sticks to the top of the screen as the user scrolls through the timestamp list, so the player remains visible while browsing and tapping timestamps.

### Continue watching

Watch progress is tracked per user, per video. The current playback position is periodically saved to the database. On the home screen, the "Continue Watching" row shows videos where the user's saved position is greater than zero and less than the video's full duration, ordered by most recently watched.

---

## 9. Deferred Features

The following features are intentionally excluded from the initial build. The data architecture is designed to accommodate them when needed.

| Feature | Notes |
|---|---|
| Custom role creation UI | The schema supports arbitrary roles with any permission combination. The admin UI for creating/editing roles is deferred — only the three hardcoded roles are available initially. |
| Explicit collections / playlists | Manually curated groupings with custom ordering, separate from the tag system. Tag-folders serve as the v1 grouping mechanism. |
| Timestamp-level search results | Searching currently returns video-level results. A future enhancement could surface specific timestamped moments matching the query, with click-to-jump. |
