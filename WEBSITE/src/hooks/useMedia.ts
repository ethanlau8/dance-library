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
        // Step 1: get matching media_ids
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

        // Group by media_id and count distinct tags
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

        // Step 2: fetch those media items with sorting and pagination
        let query = supabase
          .from('media')
          .select('*', { count: 'exact' })
          .in('id', matchingIds)

        if (mediaType) query = query.eq('media_type', mediaType)
        query = applyDateFilter(query, fromDate, toDate)
        query = applySorting(query, sortBy)
        query = query.range(from, to)

        const { data, count, error } = await query
        if (error) throw error

        const items = data || []
        if (append) setMedia(prev => [...prev, ...items])
        else setMedia(items)
        setTotalCount(count ?? 0)
        setHasMore(items.length === PAGE_SIZE)
        await fetchTagsForMedia(items, append)
      } else {
        // No tag filters
        let query = supabase
          .from('media')
          .select('*', { count: 'exact' })

        if (mediaType) query = query.eq('media_type', mediaType)
        query = applyDateFilter(query, fromDate, toDate)
        query = applySorting(query, sortBy)
        query = query.range(from, to)

        const { data, count, error } = await query
        if (error) throw error

        const items = data || []
        if (append) setMedia(prev => [...prev, ...items])
        else setMedia(items)
        setTotalCount(count ?? 0)
        setHasMore(items.length === PAGE_SIZE)
        await fetchTagsForMedia(items, append)
      }
    } catch (err) {
      console.error('Error fetching media:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, JSON.stringify(allTagIds), fromDate, toDate, mediaType])

  const fetchTagsForMedia = async (items: Media[], append: boolean) => {
    if (items.length === 0) return
    const mediaIds = items.map(m => m.id)

    const { data: mtData } = await supabase
      .from('media_tags')
      .select('media_id, tag_id, start_time, tags(id, name, description, category_id, is_folder, created_by, created_at)')
      .in('media_id', mediaIds)
      .is('start_time', null)

    if (!mtData) return

    const tagMap: Record<string, Tag[]> = {}
    for (const mt of mtData as unknown as Array<{ media_id: string; tag_id: string; start_time: number | null; tags: Tag | Tag[] }>) {
      if (!mt.tags) continue
      // Supabase may return the join as an object or array depending on relationship
      const tag: Tag = Array.isArray(mt.tags) ? mt.tags[0] : mt.tags
      if (!tag) continue
      if (!tagMap[mt.media_id]) tagMap[mt.media_id] = []
      // Deduplicate by tag id
      if (!tagMap[mt.media_id].some(t => t.id === tag.id)) {
        tagMap[mt.media_id].push(tag)
      }
    }

    if (append) {
      setMediaTags(prev => ({ ...prev, ...tagMap }))
    } else {
      setMediaTags(tagMap)
    }
  }

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
