# UX Design

## 1. Design Principles

### Mobile-first

The platform is designed primarily for mobile use. All screens, interactions, and layouts are designed for small viewports first and adapt to desktop as a secondary concern.

### Search-forward

The primary use case is finding a specific move or video. The search bar is always visible at the top of the home screen. The entire navigation structure is optimized for "I need to find that move" over passive browsing.

### Lazy loading

The grid and feed views display only static thumbnail images. Video files are never loaded until the user opens a specific video's detail page. This keeps the browsing experience fast and minimizes bandwidth and API calls.

---

## 2. Navigation Structure

### Home screen as the hub

The home screen is the central navigation point. All paths lead back to it: folder views, video detail pages, search results, and admin screens all have a back action that returns to the home screen.

### Hamburger menu

A hamburger icon (≡) in the top-right of the home screen opens a navigation menu:

```
┌──────────────────┐
│  Dance Library    │
│  ─────────────── │
│  All Videos       │
│  Folders          │
│  Tags             │
│  ─────────────── │
│  Admin            │
│  ─────────────── │
│  Log Out          │
└──────────────────┘
```

| Item | Description | Visibility |
|---|---|---|
| All Videos | Returns to the home screen video grid | Always |
| Folders | Lists all folder-tags for quick navigation | Always |
| Tags | Browse and manage all tags (see Section 13) | Always (create/edit gated by permissions) |
| Admin | User and role management | Only if user has `manage_roles` permission |
| Log Out | Ends the session | Always |

### No bottom tab bar

The platform does not use a bottom tab bar. For a personal archive, there are not enough distinct top-level sections to justify persistent bottom navigation. The hamburger menu handles infrequent navigations (admin, tag management), while the home screen provides direct access to the primary actions (search, folders, browsing).

### Deep links

Every video and folder has a stable, shareable URL:

- Videos: `/video/{id}`
- Folders: `/folder/{tag_id}`

Sharing a URL with someone who has an account and an assigned role takes them directly to that page. Users without auth are redirected to login. Users without a role see the empty state.

---

## 3. Home Screen

The home screen consists of four sections in a single scrollable view:

```
┌──────────────────────────────────┐
│  Dance Library           [≡] [+] │
│  ┌────────────────────────────┐  │
│  │  Search moves...           │  │
│  └────────────────────────────┘  │
│                                  │
│  Continue Watching               │
│  ┌──────┐┌──────┐┌──────┐       │
│  │thumb ││thumb ││thumb │ >>>    │
│  │▶2:31 ││▶0:45 ││▶1:10 │       │
│  └──────┘└──────┘└──────┘       │
│                                  │
│  Folders                         │
│  ┌──────┐┌──────┐┌──────┐       │
│  │  📁  ││  📁  ││  📁  │ >>>   │
│  │Bachta││Salsa ││ Zouk │       │
│  │ (24) ││ (18) ││ (12) │       │
│  └──────┘└──────┘└──────┘       │
│                                  │
│  All Videos (87)  [▦][▤] [Filt.] │
│  ┌──────────┬──────────┬───────┐ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  ├──────────┼──────────┼───────┤ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  ├──────────┼──────────┼───────┤ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  └──────────┴──────────┴───────┘ │
│                                  │
└──────────────────────────────────┘
```

### Search bar

Persistent at the top of the home screen. Tapping it opens the full-screen search overlay (see Section 6). The search bar does not scroll away — it remains fixed at the top.

### Continue Watching

A horizontal scrollable row of videos the user has partially watched. Each item shows the video thumbnail with a small play icon and the position timestamp (e.g., "▶ 2:31") indicating where the user left off. Items are ordered by most recently watched. Tapping an item opens the video detail page and resumes from the saved position.

This section is hidden if the user has no watch history.

### Folders

A horizontal scrollable row of folder-tag icons. Each folder shows the tag name and a count of videos with that tag. Tapping a folder opens the folder view (see Section 4).

This section is hidden if no tags have `is_folder` set to true.

### All Videos grid

The complete media catalog displayed below the folders. A header row shows the total count, the view toggle, sort control, and a filter button.

**View toggle:**
- Grid icon (▦) — switches to the 3-column thumbnail grid
- Feed icon (▤) — switches to the single-column feed

The selected view is persisted in localStorage.

**Sort options:** A dropdown with three options:
- Upload date (newest first) — the default
- Recorded date (newest first)
- Alphabetical (title A-Z)

**Infinite scroll:** More videos are loaded automatically as the user scrolls near the bottom of the grid. No "Load more" button or pagination.

### Grid view (A)

Instagram-style tight thumbnail grid. Three columns. Square thumbnails. Thin 1-2px borders between cells. No padding, no gaps. No title, tags, or metadata visible. Purely visual browsing. Tapping a thumbnail opens the video detail page.

```
┌──────────┬──────────┬──────────┐
│          │          │          │
│  thumb   │  thumb   │  thumb   │
│          │          │          │
├──────────┼──────────┼──────────┤
│          │          │          │
│  thumb   │  thumb   │  thumb   │
│          │          │          │
├──────────┼──────────┼──────────┤
│          │          │          │
│  thumb   │  thumb   │  thumb   │
│          │          │          │
└──────────┴──────────┴──────────┘
```

### Feed view (D)

Single-column feed with full-width thumbnails. Each item shows the thumbnail, title, tag chips, and recorded date. Maximum detail per item. Tapping an item opens the video detail page.

```
┌──────────────────────────────┐
│                              │
│         THUMBNAIL            │
│                              │
└──────────────────────────────┘
Cross-Body Lead Tutorial
[bachata] [intermediate]
Mar 15, 2025

┌──────────────────────────────┐
│                              │
│         THUMBNAIL            │
│                              │
└──────────────────────────────┘
Salsa Turn Patterns
[salsa] [turn] [advanced]
Mar 12, 2025
```

---

## 4. Folder View

Tapping a folder from the home screen opens a filtered view scoped to videos with that tag. The layout is functionally identical to the home screen's All Videos grid with a pre-applied filter.

```
┌──────────────────────────────────┐
│  ← Bachata (24)      [Filters v] │
│  ┌────────────────────────────┐  │
│  │  Search in Bachata...      │  │
│  └────────────────────────────┘  │
│                                  │
│  [▦] [▤]                        │
│  ┌──────────┬──────────┬───────┐ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  ├──────────┼──────────┼───────┤ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  ├──────────┼──────────┼───────┤ │
│  │          │          │       │ │
│  │  thumb   │  thumb   │ thumb │ │
│  │          │          │       │ │
│  └──────────┴──────────┴───────┘ │
└──────────────────────────────────┘
```

- **Back arrow** returns to the home screen.
- **Search bar** is scoped — searches only within videos that have this folder's tag.
- **Filters** are available for further narrowing (e.g., find all beginner bachata videos).
- **View toggle** (A/D) is available, same behavior as the home screen.

---

## 5. Video Detail Page

The video detail page is the core interaction surface. It opens when the user taps a video from any grid, feed, folder, or search result.

### Initial state

```
┌──────────────────────────────────┐
│ ← Back                    [edit] │
│ ┌──────────────────────────────┐ │
│ │                              │ │
│ │         VIDEO PLAYER         │ │
│ │                              │ │
│ │    advancement bar────────── │ │
│ │  ▼     ▼       ▼      ▼     │ │
│ └──────────────────────────────┘ │
│                                  │
│  Cross-Body Lead Tutorial        │
│  Mar 15, 2025  ·  4:32          │
│                                  │
│  Description text goes here.     │
│  Can be a couple lines long,     │
│  nothing crazy.                  │
│                                  │
│  [bachata] [intermediate]        │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Timestamps                      │
│  ┌────────────────────────────┐  │
│  │  ▶ 0:32 - 0:48            │  │
│  │  cross-body lead           │  │
│  ├────────────────────────────┤  │
│  │  ▶ 1:15 - 1:30            │  │
│  │  inside turn               │  │
│  ├────────────────────────────┤  │
│  │  ▶ 1:45 - 2:01            │  │
│  │  cross-body lead           │  │
│  ├────────────────────────────┤  │
│  │  ▶ 2:10 - 2:25            │  │
│  │  hammer lock               │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

### Scrolled state (sticky player)

When the user scrolls down to browse the timestamp list, the video player sticks to the top of the viewport. The player may shrink slightly to preserve screen space for the list below.

```
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │
│ │  STICKY PLAYER (smaller)     │ │
│ │  ▼     ▼       ▼      ▼     │ │
│ └──────────────────────────────┘ │
│                                  │
│  Timestamps                      │
│  ┌────────────────────────────┐  │
│  │  ▶ 0:32 - 0:48            │  │
│  │  cross-body lead           │  │
│  ├────────────────────────────┤  │
│  │  ▶ 1:15 - 1:30            │  │
│  │  inside turn               │  │
│  ├────────────────────────────┤  │
│  │  ▶ 1:45 - 2:01            │  │
│  │  cross-body lead           │  │
│  ├────────────────────────────┤  │
│  │  ▶ 2:10 - 2:25            │  │
│  │  hammer lock               │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

### Component details

**Back button:** Returns to the previous screen (home, folder view, or search results).

**Edit button:** Only visible to users with `edit_metadata` permission. Opens inline edit mode (see Section 9).

**Video player:** Standard HTML5 video player. The video file is loaded on this page only (lazy loading). A presigned URL is fetched from the `get-media-url` Edge Function when the page opens.

**Timeline markers:** Small visual indicators (▼) on the player's progress bar at the `start_time` position of each timestamp tag. These provide an at-a-glance overview of where tagged moments are in the video.

**Title and date:** The video title, recorded date, and duration are displayed below the player.

**Description:** Freetext description below the title. Can be multiple lines.

**Video-level tags:** Displayed as tappable chips (e.g., `[bachata] [intermediate]`). Tapping a tag chip navigates to the home grid with that tag applied as a filter.

**Timestamp tag list:** A list of all timestamped tag applications, ordered by `start_time`. Each row shows:
- A play icon (▶) indicating it's tappable
- The time range (start - end)
- The tag name

Tapping a row jumps the video player to that timestamp. Because the player is sticky, the video remains visible while the user browses and taps through the list.

---

## 6. Search Overlay

Tapping the search bar on the home screen opens a full-screen search overlay.

```
┌──────────────────────────────────┐
│  ┌────────────────────────┐  [X] │
│  │  cross-body lead...    │      │
│  └────────────────────────┘      │
│                                  │
│  Recent Searches                 │
│  cross-body lead                 │
│  bachata workshop                │
│  inside turn                     │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Videos                          │
│  ┌────────────────────────────┐  │
│  │ ┌─────┐ Cross-Body Lead   │  │
│  │ │thumb│ Tutorial           │  │
│  │ └─────┘ [bachata] [int]   │  │
│  ├────────────────────────────┤  │
│  │ ┌─────┐ Workshop Day 2    │  │
│  │ │thumb│ Contains: cross-  │  │
│  │ └─────┘ body lead         │  │
│  └────────────────────────────┘  │
│                                  │
│  Tags                            │
│  [cross-body lead] [cross turn]  │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Search input:** Auto-focused when the overlay opens. Results appear live as the user types.

**Recent searches:** Displayed below the search bar before the user starts typing. Stored in localStorage. Tapping a recent search fills the search bar and triggers the search.

**Results — Videos:** Matching media items shown with a small thumbnail, title, and tag chips. Tapping a video result opens its detail page.

**Results — Tags:** Matching tag names shown as chips below the video results. Tapping a tag chip closes the search overlay and applies that tag as a filter on the home grid.

**Close button (X):** Closes the overlay and returns to the home screen without applying any action.

---

## 7. Filter Panel

Tapping [Filters] on the home screen or folder view opens a bottom sheet.

```
┌──────────────────────────────────┐
│                                  │
│  (dimmed home grid behind)       │
│                                  │
├──────────────────────────────────┤
│  Filters                 [Clear] │
│                                  │
│  Style                           │
│  [bachata] [salsa] [zouk]        │
│  [kizomba] [+3 more]            │
│                                  │
│  Difficulty                      │
│  [beginner] [intermediate]       │
│  [advanced]                      │
│                                  │
│  Move                            │
│  [cross-body] [inside turn]      │
│  [hammer lock] [+12 more]       │
│                                  │
│  Date Range                      │
│  [From: ___] [To: ___]          │
│                                  │
│  [Apply Filters]                 │
└──────────────────────────────────┘
```

### Behavior

**Bottom sheet:** Slides up from the bottom of the screen over the dimmed content behind. Does not navigate away from the current view.

**Tag categories as sections:** Each tag category (Style, Difficulty, Move, etc.) is displayed as a section header with its tags as selectable chips below. Categories with many tags show a "+N more" control to expand.

**Multi-select:** Multiple tags can be selected within and across categories. Selected chips are visually highlighted.

**Date range:** Two date inputs (From and To) for filtering by recorded date. If a video has no recorded date, its upload date is used as a fallback. Either or both inputs can be set.

**Clear button:** Deselects all filters.

**Apply Filters:** Closes the bottom sheet and applies the selected filters to the grid. The grid updates to show only matching videos.

**Active filter chips:** After applying, active filters appear as removable chips above the video grid on the home screen or folder view. Tapping the × on a chip removes that individual filter.

```
  [bachata ×] [intermediate ×]
  ┌──────────┬──────────┬───────┐
  │  thumb   │  thumb   │ thumb │
  ...
```

---

## 8. Upload Flow

Tapping [+] on the home screen opens the upload page. Only visible to users with `upload_media` permission.

```
┌──────────────────────────────────┐
│  ← Upload                        │
│                                  │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │    Tap to select file      │  │
│  │    or drag and drop        │  │
│  │                            │  │
│  │    Video, Image, or        │  │
│  │    other media             │  │
│  └────────────────────────────┘  │
│                                  │
│  (After file selected:)          │
│                                  │
│  ┌──────┐                        │
│  │thumb │  video.mp4             │
│  │ gen  │  48MB · 4:32           │
│  └──────┘  Generating thumbnail… │
│                                  │
│  Title                           │
│  ┌────────────────────────────┐  │
│  │  Cross-Body Lead Tutorial  │  │
│  └────────────────────────────┘  │
│                                  │
│  Description                     │
│  ┌────────────────────────────┐  │
│  │  Workshop footage from...  │  │
│  └────────────────────────────┘  │
│                                  │
│  Recorded Date                   │
│  [Mar 15, 2025] (from metadata)  │
│                                  │
│  Tags                            │
│  [bachata] [intermediate] [+ Add]│
│                                  │
│  ┌────────────────────────────┐  │
│  │ ████████████░░░░ 72%       │  │
│  │         Uploading...       │  │
│  └────────────────────────────┘  │
│                                  │
│  [Upload]                        │
└──────────────────────────────────┘
```

### Behavior

**File selection:** A drop zone that opens the device file picker on tap. On desktop, drag and drop is also supported.

**Thumbnail generation:** For video files, a thumbnail is generated client-side using ffmpeg.wasm. A loading state is shown while this runs. For images, the image itself serves as the thumbnail.

**Recorded date:** Auto-extracted from the video file's metadata. Displayed with the option to manually edit if the metadata is missing or incorrect.

**Metadata form:** Title, description, and recorded date fields. Title is required. Description is optional.

**Tags:** Existing tags can be applied during upload using an add control. If the user has `create_tags` permission, they can also create new tags inline. Timestamp tags are not added during upload — they require watching the video and are added later via edit mode.

**Progress bar:** Appears when the upload begins. Shows the file upload progress to R2. The Upload button is disabled while uploading.

**Upload button:** Submits the file and metadata. Disabled until a file is selected and a title is entered. After successful upload, navigates to the new video's detail page.

---

## 9. Edit Mode

Tapping [edit] on the video detail page transforms the page into an editable state. Only available to users with `edit_metadata` permission.

```
┌──────────────────────────────────┐
│ [Cancel]              [Save]     │
│ ┌──────────────────────────────┐ │
│ │         VIDEO PLAYER         │ │
│ │  ▼     ▼       ▼      ▼     │ │
│ └──────────────────────────────┘ │
│                                  │
│  Title                           │
│  ┌────────────────────────────┐  │
│  │  Cross-Body Lead Tutorial  │  │
│  └────────────────────────────┘  │
│                                  │
│  Description                     │
│  ┌────────────────────────────┐  │
│  │  Workshop footage from...  │  │
│  └────────────────────────────┘  │
│                                  │
│  Recorded Date                   │
│  [Mar 15, 2025]                  │
│                                  │
│  Tags                            │
│  [bachata ×] [intermediate ×]    │
│  [+ Add tag]                     │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Timestamps                      │
│  ┌────────────────────────────┐  │
│  │  0:32 - 0:48  cross-body  │  │
│  │               [edit] [del]│  │
│  ├────────────────────────────┤  │
│  │  1:15 - 1:30  inside turn │  │
│  │               [edit] [del]│  │
│  └────────────────────────────┘  │
│                                  │
│  [+ Add timestamp tag]          │
│                                  │
│  ─────────────────────────────── │
│  Replace Video File              │
│  [Choose new file]               │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Cancel/Save controls:** Replace the Back/Edit buttons at the top. Cancel discards changes and returns to the detail page view. Save commits all changes and returns to the detail page view.

**Editable fields:** Title, description, and recorded date become editable text inputs.

**Tag management:**
- Existing tags show × buttons for removal.
- [+ Add tag] opens a tag picker where the user can search existing tags or create new ones (if they have `create_tags` permission).

**Timestamp management:**
- Each timestamp row gains [edit] and [del] controls.
- [edit] allows modifying the start/end time and the tag selection.
- [del] removes that timestamp application.
- [+ Add timestamp tag] initiates the timestamp creation flow: the user plays or scrubs the video to set the start time (current position), then sets the end time, selects or creates a tag, and confirms.

**Replace Video File:** A button at the bottom of the edit mode. Opens a file picker. Selecting a new file replaces the video in R2, regenerates the thumbnail, and updates the media record. All existing metadata and tags are preserved.

**Delete media:** Below Replace Video File, a "Danger Zone" section contains a delete button. Only visible to users who uploaded the media OR whose role has `delete_media` permission. Tapping it opens a confirmation dialog.

```
┌──────────────────────────────────┐
│  ...                             │
│  ─────────────────────────────── │
│  Replace Video File              │
│  [Choose new file]               │
│                                  │
│  ─────────────────────────────── │
│  Danger Zone                     │
│  ┌────────────────────────────┐  │
│  │  🗑  Delete this video     │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘

Tapping delete opens confirmation:
┌──────────────────────────────────┐
│                                  │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │  Delete this video?        │  │
│  │                            │  │
│  │  This will permanently     │  │
│  │  remove the video file     │  │
│  │  and all its tags.         │  │
│  │                            │  │
│  │  [Cancel]  [Delete]        │  │
│  │            (red button)    │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

### Tag picker

Tapping [+ Add tag] in edit mode or during upload opens a tag picker as a bottom sheet.

```
┌──────────────────────────────────┐
│                                  │
│  (dimmed edit mode behind)       │
│                                  │
├──────────────────────────────────┤
│  Add Tag                   [X]   │
│  ┌────────────────────────────┐  │
│  │  🔍 Search tags...         │  │
│  └────────────────────────────┘  │
│  Category: [All           ▾]    │
│                                  │
│  Style                           │
│  ┌────────────────────────────┐  │
│  │  bachata                   │  │
│  │  salsa                     │  │
│  │  zouk                      │  │
│  └────────────────────────────┘  │
│  Difficulty                      │
│  ┌────────────────────────────┐  │
│  │  beginner                  │  │
│  │  intermediate              │  │
│  │  advanced                  │  │
│  └────────────────────────────┘  │
│  Move                            │
│  ┌────────────────────────────┐  │
│  │  cross-body lead           │  │
│  │  inside turn               │  │
│  └────────────────────────────┘  │
│                                  │
│  (if create_tags + no match:)    │
│  [+ Create "search text"]        │
│                                  │
└──────────────────────────────────┘
```

**Search:** Filters the tag list as the user types. Shows matching tags across all categories (or filtered by the category dropdown).

**Category dropdown:** Filters tags to a single category. Defaults to "All."

**Selecting a tag:** Tapping a tag adds it to the video. The sheet stays open so the user can add multiple tags. Tap X to close.

**Create new tag:** If the user has `create_tags` permission and no existing tag matches the search text, a [+ Create] option appears. Tapping it opens the create tag sub-flow.

### Create new tag sub-flow

When the user taps [+ Create] in the tag picker, a new bottom sheet slides over the picker.

```
┌──────────────────────────────────┐
│                                  │
│  (dimmed tag picker behind)      │
│                                  │
├──────────────────────────────────┤
│  Create New Tag            [X]   │
│                                  │
│  Name                            │
│  ┌────────────────────────────┐  │
│  │  cross-body lead           │  │
│  └────────────────────────────┘  │
│                                  │
│  Category                        │
│  [Move                     ▾]   │
│                                  │
│  Description (optional)          │
│  ┌────────────────────────────┐  │
│  │  Basic lead-follow move   │  │
│  │  in salsa and bachata     │  │
│  └────────────────────────────┘  │
│                                  │
│  [Create Tag]                    │
│                                  │
└──────────────────────────────────┘
```

**Name:** Pre-filled with the search text from the tag picker.

**Category dropdown:** Lists all existing categories plus a "+ New Category" option at the bottom. Selecting "+ New Category" reveals an additional text input for the new category name.

**Description:** Optional freetext field.

**Create Tag:** Creates the tag (and category if new), immediately applies it to the current video, and returns to the tag picker with the new tag already applied.

---

## 10. Admin Screen

Accessed from the hamburger menu. Only visible to users with `manage_roles` permission.

```
┌──────────────────────────────────┐
│  ← Admin                         │
│                                  │
│  [ Users ]  [ Roles ]            │
│  ─────────────────────────────── │
│                                  │
│  Pending (2)                     │
│  ┌────────────────────────────┐  │
│  │  jane@email.com            │  │
│  │  Signed up Mar 19          │  │
│  │  [Assign Role v]           │  │
│  ├────────────────────────────┤  │
│  │  bob@email.com             │  │
│  │  Signed up Mar 18          │  │
│  │  [Assign Role v]           │  │
│  └────────────────────────────┘  │
│                                  │
│  Active (5)                      │
│  ┌────────────────────────────┐  │
│  │  you@email.com    Owner    │  │
│  ├────────────────────────────┤  │
│  │  alice@mail.com   Editor   │  │
│  │                  [Change v]│  │
│  ├────────────────────────────┤  │
│  │  mark@mail.com    Viewer   │  │
│  │                  [Change v]│  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Tabs:** Users and Roles. The Users tab is the default view.

**Pending section:** Lists users with no role assigned, ordered by signup date (newest first). Each row shows the email and a dropdown to assign a role. Once a role is assigned, the user moves to the Active section.

**Active section:** Lists all users with assigned roles. Each row shows the email and current role. A [Change] dropdown allows reassigning the role. The owner's own row does not have a change control (users cannot change their own role). If a user is the last remaining Owner, the [Change] dropdown is disabled with a tooltip or note: "Cannot change — last Owner."

**Roles tab:** Displays the existing roles and their permission flags in a read-only view. The UI for creating or editing custom roles is deferred.

---

## 11. Empty State (No Role)

Displayed to users who have signed up but have not been assigned a role.

```
┌──────────────────────────────────┐
│  Dance Library                   │
│                                  │
│                                  │
│                                  │
│                                  │
│                                  │
│                                  │
│   Your account has been created  │
│                                  │
│   Let the site owner know so     │
│   they can give you access.      │
│                                  │
│                                  │
│                                  │
│                                  │
│                         Log Out  │
│                                  │
└──────────────────────────────────┘
```

### Behavior

No navigation, no hamburger menu, no content, no functionality. The only interactive element is the Log Out action. The user must contact the site owner through external means to request access.

---

## 12. Desktop Adaptations

The mobile-first layout adapts to wider viewports with the following changes:

### Home screen

- The search bar, Continue Watching row, and Folders row expand to use available width but remain structurally the same.
- The grid view (A) scales to more columns (4-6 depending on viewport width) while maintaining the tight, borderless Instagram-style layout.
- The feed view (D) centers in the viewport with a max-width constraint to prevent thumbnails from stretching excessively.

### Folder view

- Same adaptations as the home screen grid.

### Video detail page

- The video player takes up the left portion of the screen.
- The metadata and timestamp list appear in a sidebar to the right of the player rather than below it.
- The sticky player behavior is not needed on desktop since both the player and timestamps are visible simultaneously.

### Search overlay

- The overlay may render as a centered modal or dropdown below the search bar instead of a full-screen takeover.

### Filter panel

- The bottom sheet may render as a sidebar panel or dropdown instead.

### Upload flow

- Drag and drop is supported alongside the file picker.
- The form layout may use a wider single-column or two-column arrangement.

### Admin screen

- The user list can use a table layout with columns for email, role, signup date, and actions.

---

## 13. Login / Signup Screen

A simple, single-page authentication screen.

```
┌──────────────────────────────────┐
│                                  │
│                                  │
│         Dance Library            │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Email                     │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Password                  │  │
│  └────────────────────────────┘  │
│                                  │
│  [Log In]                        │
│                                  │
│  Don't have an account?          │
│  Sign Up                         │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Toggle:** A text link below the submit button switches between Login and Sign Up modes. In Sign Up mode, the button text changes to "Sign Up" and an optional display name field may be shown.

**Auth method:** Email and password via Supabase Auth. No OAuth providers, no magic links.

**After login:** If the user has a role, they are taken to the home screen. If they have no role, they see the empty state (Section 11).

**After signup:** The user sees the empty state immediately. The first-ever signup is automatically assigned the Owner role (see feature-design.md, Section 2).

---

## 14. Tag Management Screen

Accessed from the hamburger menu via "Tags." Allows browsing and managing the tag vocabulary.

```
┌──────────────────────────────────┐
│ ← Tags               [+ New Tag] │
│ ┌────────────────────────────┐   │
│ │  🔍 Search tags...         │   │
│ └────────────────────────────┘   │
│                                  │
│ Style                            │
│ ┌────────────────────────────┐   │
│ │ bachata              📁 ✎  │   │
│ │ salsa                📁 ✎  │   │
│ │ zouk                    ✎  │   │
│ │ kizomba                 ✎  │   │
│ └────────────────────────────┘   │
│                                  │
│ Difficulty                       │
│ ┌────────────────────────────┐   │
│ │ beginner                ✎  │   │
│ │ intermediate            ✎  │   │
│ │ advanced                ✎  │   │
│ └────────────────────────────┘   │
│                                  │
│ Move                             │
│ ┌────────────────────────────┐   │
│ │ cross-body lead      📁 ✎  │   │
│ │ inside turn             ✎  │   │
│ │ hammer lock             ✎  │   │
│ │ copa                    ✎  │   │
│ └────────────────────────────┘   │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Layout:** All tags listed under their category headers in a single scrollable view.

**Search:** Filters the tag list as the user types, across all categories.

**Folder indicator (📁):** Shown on tags that have `is_folder` set to true. Users with `manage_folders` permission can tap to toggle the folder status on or off.

**Edit button (✎):** Opens an inline edit view for the tag's name and description. Only visible to users with `create_tags` permission.

**[+ New Tag]:** Opens the create new tag sub-flow (see Section 9). Only visible to users with `create_tags` permission.

**Read-only for Viewers:** Users without `create_tags` or `manage_folders` see the tag list without any action controls — browse only.
