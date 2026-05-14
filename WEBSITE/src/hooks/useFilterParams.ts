import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryKeys } from '../lib/queryKeys'
import type { SortBy, TagMode } from './useMedia'
import type { Tag } from '../types'

const DEFAULT_SORT: SortBy = 'recorded_date'

export function useFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  // --- Read from URL ---
  const sortBy: SortBy = (searchParams.get('sort') as SortBy) || DEFAULT_SORT
  const tagIds = useMemo(() => {
    const raw = searchParams.get('tags')
    return raw ? raw.split(',').filter(Boolean) : []
  }, [searchParams])
  const tagMode: TagMode = (searchParams.get('match') as TagMode) || 'and'
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')
  const mediaType = searchParams.get('type')

  // --- Resolve tag IDs to full Tag objects for display ---
  const { data: tagObjects = [] } = useQuery({
    queryKey: queryKeys.tags.byIds(tagIds),
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .in('id', tagIds)
      if (error) throw error
      return data ?? []
    },
    enabled: tagIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // --- Write helpers ---
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }
      // Omit defaults from URL to keep it clean
      if (next.get('sort') === DEFAULT_SORT) next.delete('sort')
      if (next.get('match') === 'and') next.delete('match')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const setSortBy = useCallback((sort: SortBy) => {
    updateParams({ sort })
  }, [updateParams])

  const setTagMode = useCallback((mode: TagMode) => {
    updateParams({ match: mode })
  }, [updateParams])

  const addTag = useCallback((tagId: string) => {
    const current = new Set(tagIds)
    current.add(tagId)
    updateParams({ tags: [...current].join(',') })
  }, [tagIds, updateParams])

  const removeTag = useCallback((tagId: string) => {
    const current = tagIds.filter(id => id !== tagId)
    updateParams({ tags: current.length > 0 ? current.join(',') : null })
  }, [tagIds, updateParams])

  const setDateRange = useCallback((from: string | null, to: string | null) => {
    updateParams({ from, to })
  }, [updateParams])

  const setMediaType = useCallback((type: string | null) => {
    updateParams({ type })
  }, [updateParams])

  const clearAll = useCallback(() => {
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  // Combined apply for FilterPanel (replaces all filters at once)
  const applyFilters = useCallback((tags: Tag[], dateRange: { from: string | null; to: string | null }, type: string | null, mode: TagMode) => {
    const params: Record<string, string | null> = {
      tags: tags.length > 0 ? tags.map(t => t.id).join(',') : null,
      from: dateRange.from,
      to: dateRange.to,
      type,
      sort: sortBy,
      match: mode,
    }
    updateParams(params)
  }, [sortBy, updateParams])

  return {
    sortBy,
    setSortBy,
    tagIds,
    tagMode,
    tagObjects,
    addTag,
    removeTag,
    setTagMode,
    fromDate,
    toDate,
    setDateRange,
    mediaType,
    setMediaType,
    clearAll,
    applyFilters,
  }
}
