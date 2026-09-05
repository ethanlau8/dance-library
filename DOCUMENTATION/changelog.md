# Changelog

## [2026-09-05] - Sortable Columns on the Tags Table
**Type**: Feature

**Context**: The Tags table shipped with a fixed three-option sort dropdown (name / category / most used) and no way to reverse any of them. With 131 tags the useful questions are directional — *which tags are unused*, *which carry the library* — and half of them were unreachable.

**Changed**:
- `WEBSITE/src/lib/tagSort.ts` (new): comparators, labels, per-column default directions, and the click-to-next-sort transition. Kept out of the component so the ordering rules are unit-testable, and generic over minimal row shapes so `lib` does not depend on hook types.
- `WEBSITE/src/lib/tagSort.test.ts` (new): 13 tests covering the two non-obvious rules below plus numeric-vs-lexicographic ordering and input immutability.
- `WEBSITE/src/pages/TagsPage.tsx`: every column heading is a `SortHeader` button; separate sort state per tab; the toolbar dropdown gained a direction toggle beside it.
- `DOCUMENTATION/ux-design.md`: §14 sort behaviour rewritten.

**Decisions worth keeping**:
- **Per-column default direction.** A fresh text column opens ascending, a fresh count column descending. Opening *Used* ascending would land on the 60 tags used by nothing.
- **Empty descriptions sort last in both directions.** 126 of 131 tags have no description; letting blanks flip to the top would make one direction of that column show nothing but dashes. Direction orders only the rows that have one.
- **Ties break on name → category → id.** Tag names are unique only within a category — 7 names currently exist in two categories at once — so name alone leaves pairs unordered and the table reshuffles when an unrelated row changes.
- Only the active column renders an arrow, so the header row states one sort rather than hinting at four.

**Not included**: sorting by folder status. The folder toggle shares a cell with edit/delete and has no heading of its own, so it would have been a dropdown option with no matching clickable column.

**Testing**:
- [ ] Click each heading — sorts by it; clicking again reverses; only that column shows an arrow
- [ ] *Used* opens descending on first click, *Name* opens ascending
- [ ] Sort by Description both ways — blank rows stay at the bottom in both
- [ ] Toolbar dropdown and headings stay in sync; the ↑/↓ button reverses without changing the column
- [ ] Switch tabs — each tab keeps its own sort
- [ ] On a phone (no headings) the dropdown plus direction button still reach every ordering

---

## [2026-09-04] - Layout Clipping, Keyboard-Aware Sheets, Tag Management Rebuild
**Type**: Fix + Feature

**Context**: A review of the app's visual behaviour found three problems with one root cause each, plus a tag vocabulary that had outgrown its screen.

### 1. Four pages were clipped, not scrollable

`Layout.tsx` set `overflow-y-hidden` on `<main>` in dd100dc so HomePage and FolderPage could own an internal scroll region. Those two were converted; TagsPage, AdminPage, UploadPage, and VideoDetailPage were not — they still render ordinary document-flow roots. Because a flex item with non-visible overflow has its automatic minimum size collapsed to zero, `main` was pinned to `100vh - 56px` and clipped anything longer, with no scrollbar. Those pages also kept `sticky top-14` headers whose offset was measured against a container that no longer scrolled.

**Changed**:
- `WEBSITE/src/components/Layout.tsx`: `main` is now `overflow-y-auto`. Pages with their own scrollers still fill it exactly via `flex-1` and never overflow it, so nothing nests.
- `WEBSITE/src/pages/TagsPage.tsx`, `AdminPage.tsx`: sticky headers `top-14` → `top-0` (the scrollport now starts below the fixed header).
- `WEBSITE/src/pages/VideoDetailPage.tsx`: desktop sticky player `lg:top-14` → `lg:top-0`.

### 2. The on-screen keyboard covered every bottom sheet

Sheets are `fixed bottom-0`, which anchors to the *layout* viewport. The tag picker autofocuses its search field and the create-tag form's category suggestion list was `absolute top-full` — both landed exactly where the keyboard opens.

**Changed**:
- `WEBSITE/index.html`: viewport meta gains `interactive-widget=resizes-content`.
- `WEBSITE/src/hooks/useKeyboardInset.ts` (new): measures `innerHeight - (visualViewport.height + offsetTop)`, which is 0 where the browser honours `resizes-content` and the keyboard height where it does not — so it never double-counts.
- `WEBSITE/src/components/BottomSheet.tsx` (new): shared sheet — backdrop, drag handle, header/subheader/scroll body/footer, Escape to dismiss, desktop centred dialog, and the keyboard inset applied to both `bottom` and `max-height`. Replaces seven hand-rolled copies in TagPicker (×2), FilterPanel, TagsPage (×2), and VideoDetailPage (×2).
- `WEBSITE/src/components/CategoryCombobox.tsx` (new): renders suggestions **in flow** instead of absolutely positioned, so they cannot be covered by the keyboard or clipped by the sheet's scrollport. The list collapses once the text names a category exactly, which removes the outside-click listener the old version needed.

### 3. Tag renames silently failed for Editors

The only UPDATE policy on `tags` was `tags_update_is_folder`, requiring `manage_folders`. RLS cannot be scoped to a column, so that policy governed *every* update — including the name/description edits the UI offers to anyone with `create_tags`. The seeded Editor role has `create_tags` but not `manage_folders`, so those updates matched zero rows; PostgREST reports that as success, so the UI showed the edit as saved and it reverted on reload.

**Changed**:
- `SUPABASE/supabase/migrations/20240108000000_tag_management.sql` (new, part 1): policy admits `create_tags OR manage_folders`; an `enforce_tag_update_permissions` BEFORE UPDATE trigger enforces the actual column split (`is_folder` → `manage_folders`; `name`/`description`/`category_id` → `create_tags`) and raises `42501` instead of no-oping.
- `WEBSITE/src/hooks/useTagAdmin.ts` (new): every write uses `.select()` and asserts a row came back, so an RLS-blocked write surfaces as an error rather than a fake success.

### 4. Tag management rebuilt as a two-tab table

**Changed**:
- `SUPABASE/supabase/migrations/20240108000000_tag_management.sql` (part 2): `tag_usage_counts` view (`security_invoker`) giving each tag a distinct-media count.
- `WEBSITE/src/hooks/useTagAdmin.ts` (new): all tag/category reads and writes, on TanStack Query. TagsPage previously bypassed it with raw `supabase` + `useState`.
- `WEBSITE/src/pages/TagsPage.tsx`: rewritten. `Tags` tab is a sortable table (name / description / category dropdown / usage count / folder) with multi-select and bulk move + delete; `Categories` tab makes categories first-class rows that can be renamed and deleted with an explicit choice for their tags. Categories are no longer auto-deleted when their last tag goes.
- `WEBSITE/src/components/FilterPanel.tsx`: added a tag search field, and selected tags now sort first within a category so a collapsed `+N more` can never hide an active filter the user then cannot clear.
- `WEBSITE/src/lib/matchCategory.ts` (+ test): exact, case- and whitespace-insensitive category matching, shared by the combobox and the create flows.

**Migrations**: `20240108000000_tag_management.sql` must be applied before the Tags screen works — the usage-count column reads a view that does not exist yet, and category moves are rejected until the policy lands.

**Testing**:
- [ ] **Scrolling**: Tags, Admin, Upload, and a long Video Detail page all scroll to the bottom; sticky headers sit flush under the top bar
- [ ] **Keyboard**: on a phone, open the tag picker — the search field and list stay above the keyboard; open Create Tag and focus Category — the suggestion list is visible
- [ ] **Rename as Editor**: rename a tag with an Editor account, reload — the new name persists (previously reverted)
- [ ] **Move category**: change a tag's category from the table dropdown; moving into a category that already has that name reports a conflict
- [ ] **Bulk move**: select tags across two different searches, move them together — all selected move, and the delete sheet lists them by name
- [ ] **Usage counts**: counts match the number of videos each tag is on
- [ ] **Delete category**: with tags, both "move them to…" and "delete the tags too" behave as described; an empty category survives until deleted explicitly
- [ ] **Permissions**: a Viewer sees the table with no checkboxes or action buttons

---

## [2026-05-13 ~9:00 PM] - AND/OR Tag Filter Mode Toggle
**Type**: Feature

**Context**: Tag filtering was hardcoded to AND logic (videos must match ALL selected tags). Users may want OR logic (videos matching ANY selected tag) when browsing across styles or events. Added an AND/OR toggle in the FilterPanel, defaulting to AND.

**Changed**:
- `WEBSITE/src/hooks/useMedia.ts`: Added `TagMode` type (`'and' | 'or'`), `tagMode` option to `UseMediaOptions`. The `fetchMediaPage` function now uses `tagMode` to decide whether matching media must have all tags (AND) or any tag (OR).
- `WEBSITE/src/hooks/useFilterParams.ts`: Added `tagMode` state backed by `?match=` URL param. Defaults to `'and'` (omitted from URL when default). `applyFilters` now accepts and passes `tagMode`.
- `WEBSITE/src/components/FilterPanel.tsx`: Added `activeTagMode` prop and segmented "All (AND) / Any (OR)" toggle at the top of the tag section. Resets to AND on clear.
- `WEBSITE/src/pages/HomePage.tsx`: Passes `tagMode` from `useFilterParams` to `useMedia` and `FilterPanel`.
- `WEBSITE/src/pages/FolderPage.tsx`: Same as HomePage.
- `WEBSITE/src/lib/queryKeys.ts`: Added `tagMode` to media list cache key so AND/OR queries cache independently.

**Pattern**: Follows the URL-based filter state pattern — `tagMode` is stored as `?match=or` in the URL (omitted when `and`, the default). Survives navigation and is shareable.

**Testing**:
- [ ] Open FilterPanel — "All (AND)" should be selected by default
- [ ] Select 2+ tags with AND — only videos with ALL tags appear
- [ ] Switch to "Any (OR)" and apply — videos with ANY of the selected tags appear
- [ ] Navigate away and back — tag mode persists in URL
- [ ] Clear filters — tag mode resets to AND

---

## [2026-05-13 ~8:30 PM] - Fix Fullscreen & Seekbar Click Interception
**Type**: Fix

**Context**: The fullscreen button (and seekbar) in the video player did nothing when clicked. No console errors, no logs — the click event never reached the handler. The root cause was a transparent play/pause tap area (`<button class="absolute inset-0 -z-10">`) that was supposed to sit behind all controls, but the bottom controls bar (seekbar, time display, fullscreen button) had no stacking context established. Without `position: relative` on the bottom bar, it shared the same stacking context as the tap area, and the tap area intercepted all clicks in that region.

**Changed**:
- `WEBSITE/src/components/VideoPlayer.tsx`: Added `relative` class to the bottom controls bar div so it establishes a stacking context above the `-z-10` tap area button. Also removed `overflow-y-hidden` from Layout's `<main>` element as a precaution.
- `WEBSITE/src/components/Layout.tsx`: Removed `overflow-y-hidden` from `<main>` — pages already manage their own scroll containment via inner `overflow-y-auto` divs.

**Pattern**: Followed existing custom video player pattern — fullscreen is requested on the container div (not the video element) so custom controls remain visible in fullscreen mode.

**Testing**:
- [x] Click fullscreen button on video detail page — video enters fullscreen with custom controls visible
- [x] Click fullscreen exit button — returns to normal view
- [x] Seekbar drag-to-seek works in both normal and fullscreen modes
- [x] Play/pause tap area still works (clicking the video area behind the controls)

---

## [2026-05-13 ~7:00 PM] - State & Caching Architecture (TanStack Query + URL Params)
**Type**: Enhancement/Fix

**Context**: The app had no state management layer between components and the outside world. Every page mounted fresh, fetched from scratch, and discarded everything on unmount. This caused four user-facing problems:

1. **Filters lost on navigation** - Sort, tag filters, date range, and media type were stored in React `useState`. Navigating to a video and pressing back reset everything.
2. **Wrong default sort** - Sort defaulted to `upload_date` instead of `recorded_date` on every mount.
3. **Stale FilterPanel tags** - A module-level `cachedTags` variable was set once and never invalidated. New tags wouldn't appear until a full page refresh.
4. **Videos required hard refresh to play** - The `get-media-url` edge function returned signed R2 URLs without `Cache-Control` headers, and the client `fetch()` had no `cache: 'no-store'`. Browsers cached the JSON response containing expired signed URLs.

**Changed**:

### New files
- `WEBSITE/src/lib/queryClient.ts`: QueryClient instance with defaults (2min staleTime, 10min gcTime, retry: 1, refetchOnWindowFocus: false)
- `WEBSITE/src/lib/queryKeys.ts`: Centralized query key factory for all cache keys. Prevents typo-based cache misses and enables hierarchical invalidation (e.g., invalidating `['tags']` busts `['tags', 'withCategories']`)
- `WEBSITE/src/hooks/useFilterParams.ts`: Reads/writes filter and sort state to URL search params via `useSearchParams()`. Default sort is `recorded_date`. All param updates use `replace: true` to avoid polluting browser history. Resolves tag IDs to full Tag objects via an internal useQuery for display in ActiveFilterChips/FilterPanel.

### Infrastructure
- `WEBSITE/package.json`: Added `@tanstack/react-query` dependency
- `WEBSITE/src/App.tsx`: Wrapped component tree in `<QueryClientProvider>` outside `<AuthProvider>`

### Data-fetching hooks (rewritten to TanStack Query)
- `WEBSITE/src/hooks/useMedia.ts`: Rewritten from manual useState/useEffect/useCallback to `useInfiniteQuery`. Fetch logic (tag AND-logic, date filters, sorting, pagination) extracted into a standalone `fetchMediaPage` function used as `queryFn`. Interface changed `tagFilters: Tag[]` to `tagIds: string[]` since URL params store IDs not objects. Return shape preserved for consumer compatibility.
- `WEBSITE/src/hooks/useFolders.ts`: Rewritten to `useQuery` with 5min staleTime. Both sequential queries (folder tags + media_tags counts) combined into a single queryFn.
- `WEBSITE/src/hooks/useContinueWatching.ts`: Rewritten to `useQuery` with 30s staleTime, `enabled: !!user`.
- `WEBSITE/src/hooks/useWatchProgress.ts`: Initial position load rewritten to `useQuery` with `staleTime: Infinity`. Save stays as direct Supabase upsert (fire-and-forget, called every 5s during playback).

### FilterPanel cache fix
- `WEBSITE/src/components/FilterPanel.tsx`: Deleted module-level `cachedTags` variable and manual `fetchTags()` function. Replaced with `useQuery` using the `tags.withCategories()` cache key. React Query now handles caching and invalidation automatically.

### Cache invalidation touchpoints
- `WEBSITE/src/pages/TagsPage.tsx`: Added `queryClient.invalidateQueries` calls after every mutation (create tag, edit tag, delete tag, toggle folder, edit category, delete category). Invalidates `tags.all` and `folders.all` as appropriate.
- `WEBSITE/src/components/TagPicker.tsx`: Added tag cache invalidation after tag creation.

### Page filter state migration
- `WEBSITE/src/pages/HomePage.tsx`: Replaced 5 `useState` calls (sortBy, activeTagFilters, activeDateRange, activeMediaType) with `useFilterParams()`. Deleted the `?tag=` URL param useEffect and all handler functions (handleRemoveTag, handleClearDates, handleApplyTagFilter, handleApplyFilters). SearchOverlay's `onApplyTagFilter` now calls `addTag(tag.id)`.
- `WEBSITE/src/pages/FolderPage.tsx`: Same filter state migration as HomePage. Inline folder name fetch useEffect replaced with a `useQuery`. FolderPage has independent URL params from HomePage naturally (different URL paths = different search params).

### Video playback fix
- `WEBSITE/src/pages/VideoDetailPage.tsx`: Monolithic `fetchAll()` replaced with three independent `useQuery` calls: media detail (`media.detail(id)`), media tags (`mediaTags.byMedia(id)`), and signed URL (`media.signedUrl(id)`). Signed URL query uses `cache: 'no-store'` on the fetch, `staleTime: 50min`, `gcTime: 0`, and `refetchOnMount: 'always'`. Added `queryClient.invalidateQueries` after save/replace/delete mutations.
- `WEBSITE/src/pages/VideoDetailPage.tsx`: Tag chip navigation changed from `/?tag=${tag.id}` to `/?tags=${tag.id}` to match the new URL param schema.
- `SUPABASE/supabase/functions/get-media-url/index.ts`: Added `"Cache-Control": "no-store"` to the success response headers. Belt-and-suspenders with the client-side `cache: 'no-store'`.

**Pattern**: New data-fetching pattern introduced — see below.

### New pattern: TanStack Query for data fetching

All data fetching now goes through TanStack Query hooks (`useQuery` / `useInfiniteQuery`) instead of manual `useEffect` + `useState`. This replaces the previous pattern of:

```tsx
// OLD: Manual fetch pattern
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)
useEffect(() => {
  fetchData().then(setData).finally(() => setLoading(false))
}, [deps])
```

With:

```tsx
// NEW: TanStack Query pattern
const { data, isLoading } = useQuery({
  queryKey: queryKeys.something.specific(params),
  queryFn: () => fetchData(params),
  staleTime: ...,
  enabled: !!requiredParam,
})
```

Key conventions:
- **Query keys** are defined in `src/lib/queryKeys.ts` — always use these, never inline key arrays
- **Cache invalidation** uses hierarchical keys: invalidating `queryKeys.tags.all` (`['tags']`) also invalidates `queryKeys.tags.withCategories()` (`['tags', 'withCategories']`)
- **Mutations** remain as direct async functions (not `useMutation`) when they have complex multi-step flows with progress tracking. After mutation success, call `queryClient.invalidateQueries()` on affected keys.
- **Pagination** uses `useInfiniteQuery` (see `useMedia.ts`)

### New pattern: URL-based filter state

Filter and sort state is stored in URL search params, not React component state. This means:
- Filters survive navigation (back button restores them)
- Filter URLs are shareable/bookmarkable
- Each page (HomePage, FolderPage) has independent filter state naturally

URL param schema: `/#/?sort=recorded_date&tags=id1,id2&from=2024-01-01&to=2024-06-01&type=video`

Use the `useFilterParams()` hook — do not read/write URL params manually for filters.

**Unchanged by design**:
- `AuthContext.tsx` — Supabase auth listeners don't fit React Query's model
- `SearchOverlay.tsx` — Debounced search stays manual (search UX benefits from controlling the debounce directly)
- `MediaGrid.tsx`, `ActiveFilterChips.tsx`, `ContinueWatchingRow.tsx`, `FoldersRow.tsx` — Pure consumer components, interfaces unchanged

**Testing**:
- [ ] **Filter persistence**: Apply tag + date filters on HomePage, navigate to a video, press Back — filters should still be active (visible in URL and UI)
- [ ] **Sort default**: Fresh visit with no URL params should show `recorded_date` sort selected
- [ ] **Tag cache invalidation**: Create a new tag in TagsPage, then open FilterPanel on HomePage — new tag should appear without page refresh
- [ ] **Video playback**: Navigate to a video via SPA link (not hard refresh) — video should play immediately
- [ ] **Back navigation speed**: Navigate Home, then to a video, then Back — media grid should appear instantly from cache
- [ ] **Pagination**: Scroll down to load more videos, navigate away, come back — should show first page (fresh query)
- [ ] **Folder filters independent**: Set filters on HomePage, navigate to a FolderPage — folder should have its own clean filter state
- [ ] **Signed URL freshness**: Stay on a video page for >50 minutes — React Query should refetch the signed URL automatically
