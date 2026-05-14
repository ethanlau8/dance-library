# Changelog

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
