# Prompt 7 — Search Overlay & Filter Panel

## Context

We are building **Dance Library**. The home screen has stub placeholders for search and filters (Prompt 3). The full detail, upload, and edit flows are complete.

Reference docs:
- Feature design §7 (Search & Filtering): `DOCUMENTATION/feature-design.md`
- UX design §6 (Search Overlay), §7 (Filter Panel): `DOCUMENTATION/ux-design.md`
- Key queries in `DOCUMENTATION/data-architecture.md` §8

---

## Task

Implement:
1. Full-screen **search overlay** with live results and recent searches
2. **Filter panel** (bottom sheet) with tag multi-select and date range
3. Wire both into the home screen and folder view (replacing the stubs from Prompt 3)

---

## 1. Search Overlay

`src/components/SearchOverlay.tsx`

Props:
- `isOpen: boolean`
- `onClose: () => void`
- `onApplyTagFilter: (tag: Tag) => void` — called when user taps a tag result chip

### Layout

Full-screen overlay (covers the entire viewport, including the header):

```
┌──────────────────────────────────┐
│  ┌────────────────────────┐  [X] │
│  │  Search moves...       │      │
│  └────────────────────────┘      │
│                                  │
│  Recent Searches                 │
│  [item] [item] [item]            │
│                                  │
│  ─────────────────────────────── │
│                                  │
│  Videos                          │
│  [result rows]                   │
│                                  │
│  Tags                            │
│  [tag chips]                     │
│                                  │
└──────────────────────────────────┘
```

### Behavior

**Auto-focus:** The search input is focused automatically when the overlay opens.

**Recent searches:**
- Stored in localStorage under `dance-library:recent-searches` as an array of strings (max 10)
- Displayed as a list when the input is empty
- Each item is tappable to pre-fill the input and run the search
- Updated whenever the user submits a search or taps a result

**Live results (as user types):**
- Debounce: wait 200ms after last keystroke before querying
- Run two queries in parallel:
  1. **Video search:** `ILIKE '%query%'` on `media.title`, `media.description`, and tag names via subquery (see data-architecture.md §8)
  2. **Tag search:** `ILIKE '%query%'` on `tags.name`
- Show "Videos" section with up to 10 results (thumbnail, title, tags)
- Show "Tags" section with matching tags as chips (up to 20)

**On video result tap:**
- Add the search query to recent searches
- Close the overlay
- Navigate to `/video/:id`

**On tag chip tap:**
- Add the search query to recent searches
- Close the overlay
- Call `onApplyTagFilter(tag)` to apply the tag as a filter on the home grid

**X button:** Close overlay without any action.

**Empty state:** When the input has text but no results, show "No results for '[query]'"

---

## 2. Filter Panel

`src/components/FilterPanel.tsx`

Props:
- `isOpen: boolean`
- `onClose: () => void`
- `activeTags: Tag[]`
- `activeDateRange: { from: string | null, to: string | null }`
- `onApply: (tags: Tag[], dateRange: { from: string | null, to: string | null }) => void`

### Layout

Bottom sheet that slides up from the bottom of the screen over the dimmed content:

```
─────────────────────────────────
Filters                   [Clear]

Style
[bachata] [salsa] [zouk] [+3 more]

Difficulty
[beginner] [intermediate] [advanced]

Move
[cross-body] [inside turn] [+12 more]

Date Range
[From: ___] [To: ___]

[Apply Filters]
─────────────────────────────────
```

### Data

Fetch all tags grouped by category on mount (or when first opened). Use a single query:
```sql
SELECT t.id, t.name, tc.id as category_id, tc.name as category_name
FROM tags t
JOIN tag_categories tc ON t.category_id = tc.id
ORDER BY tc.name, t.name
```

Group results by category in JavaScript.

### Behavior

**Tag selection:** Multi-select. Tapping a chip toggles its selected state. Selected chips are visually highlighted (filled background). Pre-populate with `activeTags`.

**"+N more":** If a category has more than 5 tags, show the first 5 and a "+N more" button. Tapping it expands to show all tags in that category.

**Date range:** Two `<input type="date">` fields. Either or both can be set.

**Clear:** Deselects all tag chips and clears date inputs.

**Apply Filters:** Calls `onApply()` with the selected tags and date range. Closes the bottom sheet.

**Dismiss:** Tapping the dimmed background behind the sheet closes it without applying changes.

---

## 3. Wiring into Home Screen & Folder View

Update `src/pages/HomePage.tsx` and `src/pages/FolderPage.tsx`:

**Search bar:**
- Remove the `console.log` stub
- Add `isSearchOpen` state
- Render `<SearchOverlay isOpen={isSearchOpen} onClose={...} onApplyTagFilter={...} />`
- Tapping the search bar sets `isSearchOpen = true`

**Filter button:**
- Remove the `console.log` stub
- Add `isFilterOpen` state
- Render `<FilterPanel isOpen={isFilterOpen} onClose={...} activeTags={...} onApply={...} />`
- Tapping [Filters] sets `isFilterOpen = true`

**Tag filter from URL:** On home page mount, check for `?tag=<tagId>` in the URL hash (set when user taps a tag chip on the video detail page). If present, look up the tag and add it to `activeTagFilters`.

---

## Notes

- The search overlay should render with `z-index` above everything including the fixed header.
- Bottom sheet animation: slide up from bottom (`transform: translateY`) with a CSS transition.
- The dimmed background behind the filter panel should be a semi-transparent overlay (`bg-black/50`) that also handles tap-to-dismiss.
- In the folder view, the search bar placeholder should read "Search in [FolderName]..." and the search query should be scoped to only media within that folder (add the folder tag filter to the video search query).
- Recent searches in localStorage should be capped at 10 entries — trim from the beginning when adding new ones.
