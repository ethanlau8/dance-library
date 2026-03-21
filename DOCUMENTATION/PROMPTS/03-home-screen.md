# Prompt 3 — Home Screen

## Context

We are building **Dance Library**. The project skeleton, auth, and routing are in place (Prompt 2). The Supabase backend is complete (Prompt 1).

Reference docs:
- Feature design §4 (Media), §6 (Browsing), §7 (Search/Filter): `DOCUMENTATION/feature-design.md`
- UX design §3 (Home Screen), §4 (Folder View): `DOCUMENTATION/ux-design.md`
- Key queries in `DOCUMENTATION/data-architecture.md` §8

---

## Task

Implement the **Home screen** (`src/pages/HomePage.tsx`) and all supporting components. This covers:

1. Persistent search bar (opens search overlay — stub the overlay for now)
2. Continue Watching row
3. Folders row
4. All Videos grid with view toggle, sort, and infinite scroll
5. Active filter chips display
6. Folder view page (`FolderPage.tsx`) — same layout with scoped data

Do **not** implement the search overlay or filter panel yet — those are in Prompt 7. Render stub placeholders for those interactions (e.g., tapping the search bar logs to console; tapping "Filters" logs to console).

---

## 1. Data Fetching

### Media list

`src/hooks/useMedia.ts`:

A hook that fetches paginated media from Supabase with support for:
- Sort: `upload_date` (default) | `recorded_date` | `alphabetical`
- Tag filter: array of tag UUIDs (AND logic — see query in data-architecture.md §8)
- Date range filter: `fromDate` and `toDate` (uses `COALESCE(recorded_at, created_at)`)
- Folder filter: a single tag UUID (for folder view)
- Page size: 24 items
- Infinite scroll: expose `loadMore()` and `hasMore` flag

Use Supabase JS client with `.range()` for pagination.

### Continue Watching

`src/hooks/useContinueWatching.ts`:

Fetches watch_progress records for the current user joined with media, where `position > 0` and `position < duration`, ordered by `updated_at DESC`, limited to 10.

### Folders

`src/hooks/useFolders.ts`:

Fetches all tags where `is_folder = true`, with a count of associated media items. Query:
```sql
SELECT t.id, t.name, COUNT(DISTINCT mt.media_id) AS video_count
FROM tags t
JOIN media_tags mt ON t.id = mt.tag_id
WHERE t.is_folder = true
GROUP BY t.id, t.name
ORDER BY t.name
```

---

## 2. Components

### MediaGrid

`src/components/MediaGrid.tsx`

Props: `media: Media[]`, `viewMode: 'grid' | 'feed'`, `onLoadMore: () => void`, `hasMore: boolean`

**Grid view:** 3-column tight grid. Square aspect ratio thumbnails, 1px gaps, no padding. Thumbnails use `<img src={thumbnailUrl(item.thumbnail_path)} />` where `thumbnailUrl` prepends `VITE_THUMBNAIL_BASE_URL`.

**Feed view:** Single column. Each item: full-width thumbnail (16:9), then title, tag chips (video-level tags only — deduplicated), and recorded/upload date below.

Use an `IntersectionObserver` on a sentinel element at the bottom of the list to trigger `onLoadMore`.

On thumbnail tap: navigate to `/video/:id`.

### ContinueWatchingRow

`src/components/ContinueWatchingRow.tsx`

Horizontal scrollable row. Each item: thumbnail with a progress bar overlaid at the bottom (filled to `position / duration` percent) and a "▶ 2:31" label. Hidden entirely if no items.

On tap: navigate to `/video/:id` (the video detail page will handle resuming from position).

### FoldersRow

`src/components/FoldersRow.tsx`

Horizontal scrollable row of folder cards. Each card shows the folder name and video count (e.g., "Bachata / 24"). Hidden entirely if no folders exist.

On tap: navigate to `/folder/:tagId`.

### ActiveFilterChips

`src/components/ActiveFilterChips.tsx`

Props: `activeFilters: { tags: Tag[], fromDate: string | null, toDate: string | null }`, `onRemoveTag: (tagId: string) => void`, `onClearDates: () => void`

Renders removable chips for each active tag filter and date range filter. Hidden if no filters are active.

### ViewToggle + SortDropdown

Inline controls in the All Videos header:
- View toggle: two icon buttons (grid ▦ / feed ▤). Active state visually distinct.
- Sort dropdown: native `<select>` or custom dropdown with three options.

---

## 3. Home Page Assembly

`src/pages/HomePage.tsx`:

Layout (single scrollable column):
1. **Search bar** — fixed to top of content area (below the app header from Layout). On tap: `console.log('open search')` for now.
2. **Continue Watching row** — hidden if empty
3. **Folders row** — hidden if no folders
4. **All Videos section:**
   - Header row: "All Videos (N)" count, view toggle, sort dropdown, "Filters" button
   - Active filter chips (if any)
   - `MediaGrid` component with infinite scroll

**State to manage:**
- `viewMode`: `'grid' | 'feed'` — persisted in localStorage under key `dance-library:view-mode`
- `sortBy`: `'upload_date' | 'recorded_date' | 'alphabetical'`
- `activeTagFilters`: `Tag[]`
- `activeDateRange`: `{ from: string | null, to: string | null }`

Pass filter/sort state to `useMedia` hook.

---

## 4. Folder View Page

`src/pages/FolderPage.tsx`:

Uses the `tagId` from `useParams()` to:
1. Fetch the folder tag's name and video count
2. Render the same layout as the home grid, but:
   - Header: "← [FolderName] (N)" with back arrow
   - Search bar scoped label: "Search in [FolderName]..."
   - No Continue Watching row, no Folders row
   - `useMedia` is called with `folderTagId` set to the current tag

The same view toggle, sort, and filter controls are available.

---

## 5. Thumbnail URL Helper

`src/lib/thumbnailUrl.ts`:

```ts
export function thumbnailUrl(path: string | null | undefined): string {
  if (!path) return '/placeholder-thumbnail.png'
  return `${import.meta.env.VITE_THUMBNAIL_BASE_URL}/${path}`
}
```

Add a simple placeholder thumbnail (grey rectangle) at `public/placeholder-thumbnail.png`.

---

## Notes

- Tag chips in the feed view should only show video-level tags (where `start_time IS NULL`), deduplicated. Fetch these as part of the media list query or in a separate batch query.
- The "All Videos (N)" count should reflect the total matching the current filters, not just the loaded page.
- Thumbnails should have `loading="lazy"` for performance.
- The horizontal scrollable rows should hide the scrollbar on mobile (use `-webkit-overflow-scrolling: touch` and `scrollbar-width: none`).
