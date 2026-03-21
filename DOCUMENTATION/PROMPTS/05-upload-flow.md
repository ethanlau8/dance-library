# Prompt 5 — Upload Flow

## Context

We are building **Dance Library**. Home screen, video detail, and scaffolding are complete.

Reference docs:
- Feature design §4 (Upload flow): `DOCUMENTATION/feature-design.md`
- UX design §8 (Upload Flow): `DOCUMENTATION/ux-design.md`
- Edge Functions `get-upload-url` and `create-media` in `DOCUMENTATION/data-architecture.md` §6

---

## Task

Implement the **Upload page** (`src/pages/UploadPage.tsx`) with:

1. File drop zone (tap to select + drag and drop on desktop)
2. Client-side thumbnail generation using ffmpeg.wasm
3. Recorded date extraction from video metadata
4. Direct upload to R2 via presigned URLs
5. Metadata form (title, description, recorded date, tags)
6. Tag picker (apply existing tags; create new tags inline if user has `create_tags`)
7. Upload progress bar
8. Navigate to new video detail page on success

---

## 1. ffmpeg.wasm Setup

Install:
```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util
```

`src/lib/ffmpeg.ts`:

Initialize a singleton ffmpeg instance. Load on first use (the WASM binary is large — lazy load it).

Export two functions:

**`generateThumbnail(file: File): Promise<{ blob: Blob, dataUrl: string }>`**
- Load the video file into ffmpeg
- Seek to 1 second (or frame 0 if the video is shorter)
- Extract a single frame as JPEG
- Return the blob and a data URL for preview

**`extractRecordedDate(file: File): Promise<string | null>`**
- Use ffmpeg to read the file's metadata (`ffprobe` equivalent — read the container creation_time tag)
- Return an ISO date string if found, or null

Note: ffmpeg.wasm uses SharedArrayBuffer which requires specific HTTP headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). For Vite dev server, configure these headers in `vite.config.ts`. For GitHub Pages, these headers must be set — this may require a Service Worker workaround (the `coi-serviceworker` package). Add `coi-serviceworker` to the project and register it in `index.html`.

```bash
npm install coi-serviceworker
```

---

## 2. Tag Picker Component

`src/components/TagPicker.tsx`

A bottom-sheet component (slides up from the bottom on mobile) that allows selecting and creating tags.

Props:
- `selectedTagIds: string[]`
- `onChange: (tagIds: string[]) => void`
- `onClose: () => void`
- `allowCreate: boolean` — true if user has `create_tags`

**Content:**
- Search input (filters tag list as user types)
- Category dropdown filter (defaults to "All")
- Tag list organized by category, filtered by search and category
- Each tag row is tappable to toggle selection; selected tags are visually highlighted
- If `allowCreate` and search text has no exact match: show "+ Create '[text]'" row at the bottom of the list

**Create new tag sub-flow:**

When the user taps "+ Create", slide in a secondary bottom sheet on top of the tag picker:
- Name field (pre-filled with search text)
- Category dropdown (existing categories + "+ New Category" option)
- If "+ New Category" selected: show a text input for new category name
- Description field (optional)
- "Create Tag" button

On create:
1. Insert into `tag_categories` if a new category was specified
2. Insert into `tags`
3. Automatically add the new tag to `selectedTagIds`
4. Return to the tag picker

---

## 3. Upload Page

`src/pages/UploadPage.tsx`

### Step 1: File selection

Full-page drop zone with dashed border:
```
┌──────────────────────────┐
│                          │
│   Tap to select file     │
│   or drag and drop       │
│                          │
│   Video, image, or       │
│   other media            │
│                          │
└──────────────────────────┘
```

- On tap: open native file picker (any file type accepted)
- On drag-and-drop: accept dropped files

### Step 2: File selected → metadata form

Once a file is selected:
1. Show a preview row: thumbnail (generated or placeholder while generating) + filename + file size + duration
2. If the file is a video: run `generateThumbnail()` and `extractRecordedDate()` in parallel (show a "Generating thumbnail…" state while running)
3. Show the metadata form:
   - **Title** (required) — pre-filled with the filename minus extension
   - **Description** (optional)
   - **Recorded Date** — pre-filled from metadata extraction if available; editable date input
   - **Tags** — shows applied tags as chips with × buttons; [+ Add Tag] button opens the TagPicker

### Upload flow (on Submit):

1. Disable the upload button, show progress bar
2. Call `get-upload-url` Edge Function to get presigned PUT URLs
3. Upload the video file to `media_upload_url` using `fetch()` with method PUT and the file as the body
   - Track upload progress using `XMLHttpRequest` (fetch doesn't support upload progress)
   - Update progress bar as upload proceeds
4. Upload the thumbnail blob to `thumbnail_upload_url`
5. Call `create-media` Edge Function with all metadata
6. Navigate to `/video/<returned_media_id>`

### Error handling:
- If thumbnail generation fails: allow the user to proceed without a thumbnail (thumbnail_path will be null)
- If upload fails: show an error message and allow retry (reset to the form state)

---

## 4. Helper: File Size + Duration Formatting

`src/lib/format.ts` (create or add to existing):

- `formatFileSize(bytes: number): string` — e.g., "48 MB", "1.2 GB"
- `formatDuration(seconds: number): string` — e.g., "4:32", "1:02:15"
- `formatDate(date: string | Date | null): string` — e.g., "Mar 15, 2025"

---

## Notes

- The upload progress bar tracks the video file upload only (the thumbnail upload is much smaller and fast). Show percentage from 0–100%.
- `XMLHttpRequest` must be used for upload progress tracking because the Fetch API does not expose upload progress events.
- Timestamp tags cannot be added during upload — they require the video to be loaded and playing. The tag picker here only supports video-level tags.
- If the user navigates away during upload, warn them with a `beforeunload` event.
- The TagPicker is also reused in edit mode (Prompt 6) — make it generic enough to work in both contexts.
