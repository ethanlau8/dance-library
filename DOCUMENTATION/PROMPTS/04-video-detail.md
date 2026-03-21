# Prompt 4 — Video Detail Page & Playback

## Context

We are building **Dance Library**. Home screen is complete (Prompt 3). Supabase backend and React scaffolding are in place.

Reference docs:
- Feature design §8 (Video Playback): `DOCUMENTATION/feature-design.md`
- UX design §5 (Video Detail Page): `DOCUMENTATION/ux-design.md`
- Edge Function `get-media-url` in `DOCUMENTATION/data-architecture.md` §6

---

## Task

Implement the **Video Detail page** (`src/pages/VideoDetailPage.tsx`) and all supporting components:

1. Fetch media metadata + tags
2. Fetch presigned video URL from `get-media-url` Edge Function
3. HTML5 video player with sticky behavior on scroll
4. Timeline markers on the progress bar
5. Timestamp tag list with tap-to-seek
6. Watch progress tracking (periodic save + continue watching resume)
7. Edit button (stub — full edit mode is in Prompt 6)

---

## 1. Data Fetching

### Media detail

On mount, fetch:
- Media record from `media` table by `id`
- All media_tags for this media, joined with tags and tag_categories, ordered by `start_time NULLS FIRST, tag_name`

Separate the results into:
- `videoLevelTags`: rows where `start_time IS NULL`
- `timestampTags`: rows where `start_time IS NOT NULL`, ordered by `start_time`

### Presigned video URL

Call the `get-media-url` Edge Function with the media ID:
```
GET /functions/v1/get-media-url?media_id=<id>
Authorization: Bearer <access_token>
```

Get the access token from `supabase.auth.getSession()`. Store the returned URL in state and assign it as the video element's `src`.

### Watch progress (resume)

On mount, query `watch_progress` for the current user and this media:
```sql
SELECT position FROM watch_progress
WHERE user_id = auth.uid() AND media_id = <id>
```

If a position > 0 exists, seek the video to that position after the video's `loadedmetadata` event fires.

---

## 2. Video Player Component

`src/components/VideoPlayer.tsx`

Props:
- `src: string` — the presigned URL
- `timestampTags: TimestampTag[]` — for rendering markers
- `savedPosition: number | null` — resume position in seconds
- `onTimeUpdate: (position: number) => void` — called periodically with current position
- `playerRef: React.RefObject<HTMLVideoElement>` — forwarded ref so parent can call `seekTo`

### Sticky behavior

The player should stick to the top of the viewport when the user scrolls past it.

Implementation approach:
- Use an `IntersectionObserver` on the video container to detect when it scrolls out of view
- When out of view, apply a CSS class that fixes the player to the top (smaller, e.g., reduced height) and adds padding to the content below to prevent layout jump
- When back in view, remove the sticky class

The sticky player should be smaller (e.g., `max-height: 200px`) but remain visible and functional.

### Timeline markers

Overlay markers on the video progress bar at `start_time` positions. This requires either:
- A custom progress bar element (positioned overlay)
- Or absolute-positioned markers on top of the native `<progress>` element

Each marker is a small vertical line or triangle at `(start_time / duration) * 100%` from the left.

Use a `<div>` wrapping the `<video>` element's progress bar area with `position: relative`. Render marker elements with `position: absolute; left: <percent>%`.

Note: The native `<video>` controls don't allow overlaying markers on the seek bar directly. Use the `controls` attribute for now but note that custom controls may be needed for marker support. If custom controls are needed, implement: a play/pause button, current time display, a custom seekbar (range input), duration display, and overlay markers on the seekbar track.

---

## 3. Timestamp Tag List

Below the video player, render all timestamp tags in a scrollable list.

Each row:
```
▶  0:32 - 0:48   cross-body lead
▶  1:15 - 1:30   inside turn
```

On tap: seek the video to `start_time` using `playerRef.current.currentTime = start_time`.

Format times as `M:SS` (e.g., `0:32`, `1:15`).

Highlight the currently playing timestamp: compare video's `currentTime` against each tag's `start_time` and `end_time`. The active row should be visually distinct (e.g., highlighted background).

---

## 4. Watch Progress Tracking

`src/hooks/useWatchProgress.ts`

Logic:
- Every 5 seconds (or on video `pause` event), upsert the current playback position to `watch_progress`:
  ```sql
  INSERT INTO watch_progress (id, user_id, media_id, position, updated_at)
  VALUES (gen_random_uuid(), auth.uid(), <media_id>, <position>, now())
  ON CONFLICT (user_id, media_id) DO UPDATE SET position = EXCLUDED.position, updated_at = now()
  ```
- Use Supabase's `.upsert()` with the conflict target `['user_id', 'media_id']`
- Do not save if position is 0 or >= duration (don't add videos to Continue Watching that haven't been meaningfully watched or are complete)

---

## 5. Page Assembly

`src/pages/VideoDetailPage.tsx`:

Layout (scrollable page):
```
[← Back]                          [edit]
┌──────────────────────────────────────┐
│          VIDEO PLAYER                │
│  ▼    ▼      ▼       ▼  (markers)   │
└──────────────────────────────────────┘

Title
Date · Duration

Description

[tag chip] [tag chip]

──────────────────────────────────────

Timestamps
[timestamp rows]
```

**Back button:** uses `navigate(-1)` to go back to wherever the user came from (home, folder, search).

**Edit button:** Only shown if `permissions.edit_metadata` is true. For now, clicking it can `console.log('open edit mode')` — full implementation is in Prompt 6. The edit button will be replaced by [Cancel]/[Save] in edit mode.

**Tag chips:** Tapping a video-level tag chip navigates to `/#/?tag=<tagId>` (applies that tag as a filter on the home screen). The home screen should read this from the URL on mount and apply the filter.

**Duration display:** Format as `M:SS` or `H:MM:SS` for videos over an hour.

**Date display:** Show `recorded_at` if present, otherwise `created_at`. Format as "Mar 15, 2025".

---

## Notes

- The presigned URL from `get-media-url` expires after 1 hour. If the user is still watching after expiry, the video will stop. For now, this is acceptable — a future enhancement could refresh the URL. Do not over-engineer this.
- The sticky player transition should be smooth — avoid jarring layout shifts. Use CSS transitions on the player height/position.
- If `src` is not yet loaded (waiting for the Edge Function response), show a loading spinner in the player area.
- The `onTimeUpdate` callback fires frequently — debounce or throttle the watch progress save to avoid excessive DB writes (save every 5 seconds as noted above).
