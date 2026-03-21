# Prompt 6 — Edit Mode & Timestamp Management

## Context

We are building **Dance Library**. The video detail page is complete with a stub edit button (Prompt 4). The TagPicker component exists from the upload flow (Prompt 5).

Reference docs:
- Feature design §4 (Editing, Replacing, Deleting): `DOCUMENTATION/feature-design.md`
- UX design §9 (Edit Mode): `DOCUMENTATION/ux-design.md`
- Edge Function `replace-media` in `DOCUMENTATION/data-architecture.md` §6

---

## Task

Implement **edit mode** on the video detail page. When the user taps [edit], the page transforms in-place into an editable state. This covers:

1. Toggle between view and edit mode on the video detail page
2. Editable fields: title, description, recorded date
3. Tag management: add/remove video-level tags
4. Timestamp tag management: add, edit, delete timestamped tags
5. Replace video file
6. Delete media (with confirmation)
7. Save and Cancel behavior

---

## 1. Edit Mode State

In `VideoDetailPage.tsx`, add an `isEditMode` boolean state (default false).

When `isEditMode` is true:
- The [← Back] and [edit] buttons are replaced with [Cancel] and [Save] in the header
- The title, description, and recorded date display transforms into editable inputs
- Tags show × removal buttons and a [+ Add Tag] button
- The timestamp list shows [edit] and [del] buttons on each row
- A [+ Add timestamp tag] button appears below the timestamp list
- A "Replace Video File" section appears at the bottom
- A "Danger Zone" section with a delete button appears at the very bottom

**Cancel:** Discard all local changes, reset to original fetched values, exit edit mode.

**Save:** Commit all changes:
1. If title/description/recorded_at changed: `UPDATE media SET ...` via Supabase JS client
2. If tags changed: delete removed `media_tags` rows, insert new ones
3. If timestamps changed: delete removed rows, insert new ones, update edited rows
4. Exit edit mode and re-fetch the media detail to reflect saved state

---

## 2. Editable Fields

Replace static displays with inputs when in edit mode:

- **Title:** `<input type="text">` — required, inline below the video player
- **Description:** `<textarea>` — auto-resizing
- **Recorded Date:** `<input type="date">` — pre-filled with the current recorded_at value

---

## 3. Video-Level Tag Management (in Edit Mode)

Reuse the `TagPicker` component from Prompt 5.

In edit mode:
- Existing video-level tags render with × buttons to remove them
- [+ Add Tag] opens the TagPicker bottom sheet
- Changes are held in local state until Save is tapped

---

## 4. Timestamp Tag Management

### Display in edit mode

Each timestamp row:
```
0:32 - 0:48   cross-body lead   [edit] [del]
```

[del]: immediately removes the row from local state (confirmed on Save)
[edit]: opens the timestamp edit sheet (see below)

### Add new timestamp

[+ Add timestamp tag] triggers the timestamp creation flow:

1. The video player enters "seek mode" — show an overlay/prompt: "Play or scrub to the start of the moment, then tap Set Start"
2. User plays/scrubs the video; a "Set Start" button is overlaid on or below the player
3. User taps "Set Start" → the current video time is captured as `start_time`
4. Prompt changes: "Now scrub to the end of the moment, then tap Set End"
5. User taps "Set End" → current time captured as `end_time`
6. Open a bottom sheet to select the tag for this timestamp (reuse TagPicker in single-select mode)
7. Confirm: add the timestamp tag to local state

### Edit existing timestamp

Open the same bottom sheet pre-populated with the existing values. Allow editing start_time, end_time, and the tag. Two number inputs (in seconds) or a time picker are acceptable alternatives to the seek-based flow.

---

## 5. Replace Video File

A section at the bottom of edit mode:

```
Replace Video File
[Choose new file]
```

On file selected:
1. Generate a new thumbnail using ffmpeg.wasm (same as upload flow)
2. Extract new duration and recorded date from metadata (offer to update recorded date if different)
3. Call `get-upload-url` Edge Function to get new presigned URLs
4. Show a progress bar and upload the new file + thumbnail to R2
5. Call `replace-media` Edge Function with the new paths
6. On success: update local state with new paths, re-fetch the presigned video URL

This operation happens immediately (not deferred to Save) because it involves R2 and the Edge Function. Show a loading/progress state while it runs.

---

## 6. Delete Media

At the bottom of edit mode, a Danger Zone section:

```
─────────────────────
Danger Zone
┌──────────────────────────┐
│  🗑  Delete this video   │
└──────────────────────────┘
```

Only visible if the user has `delete_media` OR the user is the uploader (`media.uploaded_by === currentUser.id`).

On tap: show a confirmation dialog:
```
Delete this video?

This will permanently remove the video file and all its tags.

[Cancel]  [Delete]
```

On confirm:
1. `DELETE FROM media WHERE id = <id>` via Supabase JS client (RLS enforces permission; CASCADE handles media_tags and watch_progress)
2. Navigate to `/` (home screen)

Note: R2 file deletion is handled separately. For now, the DB delete is sufficient. A future enhancement (or a database trigger/Edge Function) can handle orphaned R2 cleanup.

---

## Notes

- All edit state changes are held in local React state until Save is tapped. Nothing is written to the database during editing except Replace Video File (which is immediate).
- On Save, batch all DB operations: use Supabase's `.upsert()` and `.delete()` calls. If any operation fails, show an error and keep the user in edit mode.
- The TagPicker from Prompt 5 should be usable in both "multi-select" mode (for video-level tags) and "single-select" mode (for selecting a tag for a timestamp). Add a `multiSelect` prop to control this.
- Keep the video player functional in edit mode — the user needs to play/scrub to set timestamp positions.
