import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryKeys } from '../lib/queryKeys'
import BottomSheet from './BottomSheet'
import type { TagMode } from '../hooks/useMedia'
import type { Tag } from '../types'

interface FilterPanelProps {
  isOpen: boolean
  onClose: () => void
  activeTags: Tag[]
  activeTagMode: TagMode
  activeDateRange: { from: string | null; to: string | null }
  activeMediaType: string | null
  onApply: (tags: Tag[], dateRange: { from: string | null; to: string | null }, mediaType: string | null, tagMode: TagMode) => void
}

interface TagWithCategory extends Tag {
  category_name: string
}

const TAGS_VISIBLE_PER_CATEGORY = 5

export default function FilterPanel({
  isOpen,
  onClose,
  activeTags,
  activeTagMode,
  activeDateRange,
  activeMediaType,
  onApply,
}: FilterPanelProps) {
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [selectedTagMode, setSelectedTagMode] = useState<TagMode>('and')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [tagSearch, setTagSearch] = useState('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [selectedMediaType, setSelectedMediaType] = useState<string | null>(null)

  const { data: allTags = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.tags.withCategories(),
    queryFn: async (): Promise<TagWithCategory[]> => {
      const { data, error } = await supabase
        .from('tags')
        .select('*, tag_categories(id, name)')
        .order('name')

      if (error) throw error

      return (data ?? []).map((t: any) => ({
        ...t,
        category_name: t.tag_categories?.name ?? 'Uncategorized',
      }))
    },
    staleTime: 2 * 60 * 1000,
  })

  // Pre-populate from active filters when opened
  useEffect(() => {
    if (!isOpen) return
    setSelectedTagIds(new Set(activeTags.map((t) => t.id)))
    setSelectedTagMode(activeTagMode)
    setDateFrom(activeDateRange.from ?? '')
    setDateTo(activeDateRange.to ?? '')
    setSelectedMediaType(activeMediaType)
    setExpandedCategories(new Set())
    setTagSearch('')
  }, [isOpen, activeTags, activeTagMode, activeDateRange, activeMediaType])

  // Group tags by category, dropping categories with nothing matching the search.
  const groupedTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    const groups: Record<string, TagWithCategory[]> = {}
    for (const tag of allTags) {
      if (q && !tag.name.toLowerCase().includes(q)) continue
      const cat = tag.category_name
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tag)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [allTags, tagSearch])

  const isSearching = tagSearch.trim().length > 0

  function toggleTag(tag: TagWithCategory) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tag.id)) {
        next.delete(tag.id)
      } else {
        next.add(tag.id)
      }
      return next
    })
  }

  function toggleExpand(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  function handleClear() {
    setSelectedTagIds(new Set())
    setSelectedTagMode('and')
    setDateFrom('')
    setDateTo('')
    setSelectedMediaType(null)
  }

  function handleApply() {
    const selectedTags = allTags.filter((t) => selectedTagIds.has(t.id))
    onApply(
      selectedTags,
      {
        from: dateFrom || null,
        to: dateTo || null,
      },
      selectedMediaType,
      selectedTagMode
    )
    onClose()
  }

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      title="Filters"
      headerAction={
        <button onClick={handleClear} className="text-sm text-blue-600">
          Clear
        </button>
      }
      subheader={
        <div className="border-b border-gray-100 px-4 pb-3">
          <input
            type="text"
            placeholder="Search tags…"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      }
      footer={
        <div className="px-4 py-3">
          <button
            onClick={handleApply}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white active:bg-blue-700"
          >
            Apply Filters
          </button>
        </div>
      }
    >
      <div className="px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
          ) : (
            <>
              {/* Tag match mode */}
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Tag matching
                </p>
                <div className="flex rounded-lg border border-gray-200">
                  <button
                    onClick={() => setSelectedTagMode('and')}
                    className={`flex-1 rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedTagMode === 'and'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    All (AND)
                  </button>
                  <button
                    onClick={() => setSelectedTagMode('or')}
                    className={`flex-1 rounded-r-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedTagMode === 'or'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Any (OR)
                  </button>
                </div>
              </div>

              {isSearching && groupedTags.length === 0 && (
                <p className="mb-4 py-6 text-center text-sm text-gray-400">
                  No tags match &ldquo;{tagSearch.trim()}&rdquo;
                </p>
              )}

              {/* Tag categories */}
              {groupedTags.map(([category, tags]) => {
                // Selected tags sort first so a collapsed category never hides an
                // active filter the user would then be unable to clear from here.
                const ordered = [...tags].sort(
                  (a, b) =>
                    Number(selectedTagIds.has(b.id)) - Number(selectedTagIds.has(a.id))
                )
                const isExpanded = isSearching || expandedCategories.has(category)
                const visibleTags = isExpanded
                  ? ordered
                  : ordered.slice(0, TAGS_VISIBLE_PER_CATEGORY)
                const hiddenCount = ordered.length - TAGS_VISIBLE_PER_CATEGORY

                return (
                  <div key={category} className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {category}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {visibleTags.map((tag) => {
                        const isSelected = selectedTagIds.has(tag.id)
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag)}
                            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                              isSelected
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {tag.name}
                          </button>
                        )
                      })}
                      {!isExpanded && hiddenCount > 0 && (
                        <button
                          onClick={() => toggleExpand(category)}
                          className="rounded-full bg-gray-50 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                        >
                          +{hiddenCount} more
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Media type */}
              <div className="mb-4 border-t border-gray-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Media Type
                </p>
                <div className="flex gap-2">
                  {([['video', 'Videos'], ['image', 'Images']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setSelectedMediaType(prev => prev === value ? null : value)}
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        selectedMediaType === value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="mb-4 border-t border-gray-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Date Range
                </p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-gray-500">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-gray-500">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
      </div>
    </BottomSheet>
  )
}
