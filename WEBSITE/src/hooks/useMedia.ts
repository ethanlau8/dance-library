import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Media, Tag } from '../types'

export type SortBy = 'upload_date' | 'recorded_date' | 'alphabetical'

interface UseMediaOptions {
  sortBy: SortBy
  tagFilters: Tag[]
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

export function useMedia(options: UseMediaOptions): UseMediaResult {
  const { sortBy, tagFilters, fromDate, toDate, folderTagId, mediaType } = options
  const [media, setMedia] = useState<Media[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [mediaTags, setMediaTags] = useState<Record<string, Tag[]>>({})
  const pageRef = useRef(0)

  // Combine folder tag with active tag filters for the query
  const allTagIds = [
    ...(folderTagId ? [folderTagId] : []),
    ...tagFilters.map(t => t.id),
  ]

  const fetchMedia = useCallback(async (page: number, append: boolean) => {
    if (page === 0) setLoading(true)
    else setLoadingMore(true)

    try {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      if (allTagIds.length > 0) {
        // Tag filtering with AND logic: find media_ids that have ALL required tags
        const { data: tagMatches } = await supabase
          .from('media_tags')
          .select('media_id, tag_id')
          .in('tag_id', allTagIds)

        if (!tagMatches || tagMatches.length === 0) {
          setMedia(append ? prev => prev : [])
          setTotalCount(0)
          setHasMore(false)
          setLoading(false)
          setLoadingMore(false)
          return
        }

        // Group by media_id and count distinct tags — AND logic
        const mediaTagCounts: Record<string, Set<string>> = {}
        for (const mt of tagMatches) {
          if (!mediaTagCounts[mt.media_id]) mediaTagCounts[mt.media_id] = new Set()
          mediaTagCounts[mt.media_id].add(mt.tag_id)
        }

        const matchingIds = Object.entries(mediaTagCounts)
          .filter(([, tags]) => tags.size === allTagIds.length)
          .map(([id]) => id)

        if (matchingIds.length === 0) {
          setMedia(append ? prev => prev : [])
          setTotalCount(0)
          setHasMore(false)
          setLoading(false)
          setLoadingMore(false)
          return
        }

        // Fetch media with embedded tags in a single query
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

        const items = data || []
        const { mediaItems, tagMap } = extractTags(items)
        if (append) {
          setMedia(prev => [...prev, ...mediaItems])
          setMediaTags(prev => ({ ...prev, ...tagMap }))
        } else {
          setMedia(mediaItems)
          setMediaTags(tagMap)
        }
        setTotalCount(count ?? 0)
        setHasMore(items.length === PAGE_SIZE)
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

        const items = data || []
        const { mediaItems, tagMap } = extractTags(items)
        if (append) {
          setMedia(prev => [...prev, ...mediaItems])
          setMediaTags(prev => ({ ...prev, ...tagMap }))
        } else {
          setMedia(mediaItems)
          setMediaTags(tagMap)
        }
        setTotalCount(count ?? 0)
        setHasMore(items.length === PAGE_SIZE)
      }
    } catch (err) {
      console.error('Error fetching media:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, JSON.stringify(allTagIds), fromDate, toDate, mediaType])

  // Reset and fetch when filters change
  useEffect(() => {
    pageRef.current = 0
    fetchMedia(0, false)
  }, [fetchMedia])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    const nextPage = pageRef.current + 1
    pageRef.current = nextPage
    fetchMedia(nextPage, true)
  }, [loadingMore, hasMore, fetchMedia])

  return { media, totalCount, loading, loadingMore, hasMore, loadMore, mediaTags }
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
      // Supabase doesn't support COALESCE in order, so we sort by recorded_at first, then created_at
      return query.order('recorded_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    case 'alphabetical':
      return query.order('title', { ascending: true })
  }
}
