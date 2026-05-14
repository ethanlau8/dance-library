import { useMemo, useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryKeys } from '../lib/queryKeys'
import type { Media, Tag } from '../types'

export type SortBy = 'upload_date' | 'recorded_date' | 'alphabetical'
export type TagMode = 'and' | 'or'

interface UseMediaOptions {
  sortBy: SortBy
  tagIds: string[]
  tagMode?: TagMode
  fromDate: string | null
  toDate: string | null
  folderTagId: string | null
  mediaType?: string | null
}

interface UseMediaResult {
  media: Media[]
  totalCount: number
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  mediaTags: Record<string, Tag[]>
}

const PAGE_SIZE = 24

const MEDIA_WITH_TAGS_SELECT = '*, media_tags(media_id, tag_id, start_time, tags(id, name, description, category_id, is_folder, created_by, created_at))'

interface PageResult {
  items: Media[]
  tagMap: Record<string, Tag[]>
  totalCount: number
}

async function fetchMediaPage(
  page: number,
  allTagIds: string[],
  tagMode: TagMode,
  sortBy: SortBy,
  fromDate: string | null,
  toDate: string | null,
  mediaType: string | null | undefined,
): Promise<PageResult> {
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  if (allTagIds.length > 0) {
    const { data: tagMatches } = await supabase
      .from('media_tags')
      .select('media_id, tag_id')
      .in('tag_id', allTagIds)

    if (!tagMatches || tagMatches.length === 0) {
      return { items: [], tagMap: {}, totalCount: 0 }
    }

    // Group by media_id and count distinct tags
    const mediaTagCounts: Record<string, Set<string>> = {}
    for (const mt of tagMatches) {
      if (!mediaTagCounts[mt.media_id]) mediaTagCounts[mt.media_id] = new Set()
      mediaTagCounts[mt.media_id].add(mt.tag_id)
    }

    // AND = must have ALL tags, OR = must have ANY tag
    const matchingIds = Object.entries(mediaTagCounts)
      .filter(([, tags]) => tagMode === 'and' ? tags.size === allTagIds.length : tags.size > 0)
      .map(([id]) => id)

    if (matchingIds.length === 0) {
      return { items: [], tagMap: {}, totalCount: 0 }
    }

    let query = supabase
      .from('media')
      .select(MEDIA_WITH_TAGS_SELECT, { count: 'exact' })
      .in('id', matchingIds)

    if (mediaType) query = query.eq('media_type', mediaType)
    query = applyDateFilter(query, fromDate, toDate)
    query = applySorting(query, sortBy)
    query = query.range(from, to)

    const { data, count, error } = await query
    if (error) throw error

    const { mediaItems, tagMap } = extractTags(data || [])
    return { items: mediaItems, tagMap, totalCount: count ?? 0 }
  } else {
    // No tag filters — single query with embedded tags
    let query = supabase
      .from('media')
      .select(MEDIA_WITH_TAGS_SELECT, { count: 'exact' })

    if (mediaType) query = query.eq('media_type', mediaType)
    query = applyDateFilter(query, fromDate, toDate)
    query = applySorting(query, sortBy)
    query = query.range(from, to)

    const { data, count, error } = await query
    if (error) throw error

    const { mediaItems, tagMap } = extractTags(data || [])
    return { items: mediaItems, tagMap, totalCount: count ?? 0 }
  }
}

export function useMedia(options: UseMediaOptions): UseMediaResult {
  const { sortBy, tagIds, tagMode = 'and', fromDate, toDate, folderTagId, mediaType } = options

  // Combine folder tag with active tag filters for the query
  const allTagIds = useMemo(() => [
    ...(folderTagId ? [folderTagId] : []),
    ...tagIds,
  ], [folderTagId, tagIds])

  const query = useInfiniteQuery({
    queryKey: queryKeys.media.list({
      sortBy,
      tagIds: allTagIds,
      tagMode,
      fromDate,
      toDate,
      folderTagId,
      mediaType: mediaType ?? null,
    }),
    queryFn: ({ pageParam }) => fetchMediaPage(pageParam, allTagIds, tagMode, sortBy, fromDate, toDate, mediaType),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.items.length === PAGE_SIZE ? lastPageParam + 1 : undefined,
  })

  const media = useMemo(
    () => query.data?.pages.flatMap(p => p.items) ?? [],
    [query.data],
  )

  const totalCount = query.data?.pages[0]?.totalCount ?? 0

  const mediaTags = useMemo(
    () => Object.assign({}, ...(query.data?.pages.map(p => p.tagMap) ?? [])),
    [query.data],
  )

  const loadMore = useCallback(() => {
    if (!query.isFetchingNextPage && query.hasNextPage) {
      query.fetchNextPage()
    }
  }, [query])

  return {
    media,
    totalCount,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore,
    mediaTags,
  }
}

/**
 * Extract nested media_tags from Supabase join results into a flat tag map,
 * and strip the media_tags property from each media item.
 * Only includes video-level tags (start_time is null).
 */
function extractTags(items: any[]): { mediaItems: Media[]; tagMap: Record<string, Tag[]> } {
  const tagMap: Record<string, Tag[]> = {}
  const mediaItems: Media[] = []

  for (const item of items) {
    const { media_tags: rawTags, ...mediaFields } = item
    mediaItems.push(mediaFields as Media)

    if (!rawTags || !Array.isArray(rawTags)) continue

    const tags: Tag[] = []
    for (const mt of rawTags) {
      // Only video-level tags (no timestamp tags)
      if (mt.start_time != null) continue
      if (!mt.tags) continue
      const tag: Tag = Array.isArray(mt.tags) ? mt.tags[0] : mt.tags
      if (!tag) continue
      // Deduplicate
      if (!tags.some(t => t.id === tag.id)) {
        tags.push(tag)
      }
    }
    if (tags.length > 0) {
      tagMap[item.id] = tags
    }
  }

  return { mediaItems, tagMap }
}

function applyDateFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  fromDate: string | null,
  toDate: string | null,
) {
  if (fromDate) {
    query = query.or(`recorded_at.gte.${fromDate},and(recorded_at.is.null,created_at.gte.${fromDate})`)
  }
  if (toDate) {
    query = query.or(`recorded_at.lte.${toDate},and(recorded_at.is.null,created_at.lte.${toDate})`)
  }
  return query
}

function applySorting(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  sortBy: SortBy,
) {
  switch (sortBy) {
    case 'upload_date':
      return query.order('created_at', { ascending: false })
    case 'recorded_date':
      return query.order('recorded_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    case 'alphabetical':
      return query.order('title', { ascending: true })
  }
}
