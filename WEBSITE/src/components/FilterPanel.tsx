import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Tag } from '../types'

interface FilterPanelProps {
  isOpen: boolean
  onClose: () => void
  activeTags: Tag[]
  activeDateRange: { from: string | null; to: string | null }
  activeMediaType: string | null
  onApply: (tags: Tag[], dateRange: { from: string | null; to: string | null }, mediaType: string | null) => void
}

interface TagWithCategory extends Tag {
  category_name: string
}

const TAGS_VISIBLE_PER_CATEGORY = 5

export default function FilterPanel({
  isOpen,
  onClose,
  activeTags,
  activeDateRange,
  activeMediaType,
  onApply,
}: FilterPanelProps) {
  const [allTags, setAllTags] = useState<TagWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [selectedMediaType, setSelectedMediaType] = useState<string | null>(null)

  // Fetch tags on first open
  useEffect(() => {
    if (!isOpen) return
    fetchTags()
  }, [isOpen])

  // Pre-populate from active filters when opened
  useEffect(() => {
    if (!isOpen) return
    setSelectedTagIds(new Set(activeTags.map((t) => t.id)))
    setDateFrom(activeDateRange.from ?? '')
    setDateTo(activeDateRange.to ?? '')
    setSelectedMediaType(activeMediaType)
    setExpandedCategories(new Set())
  }, [isOpen, activeTags, activeDateRange, activeMediaType])

  async function fetchTags() {
    setLoading(true)
    const { data, error } = await supabase
      .from('tags')
      .select('*, tag_categories(id, name)')
      .order('name')

    if (error) {
      console.error('Error fetching tags for filter:', error)
      setLoading(false)
      return
    }

    const mapped: TagWithCategory[] = (data ?? []).map((t: any) => ({
      ...t,
      category_name: t.tag_categories?.name ?? 'Uncategorized',
    }))

    setAllTags(mapped)
    setLoading(false)
  }

  // Group tags by category
  const groupedTags = useMemo(() => {
    const groups: Record<string, TagWithCategory[]> = {}
    for (const tag of allTags) {
      const cat = tag.category_name
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tag)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [allTags])

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
      selectedMediaType
    )
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Dimmed backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-xl transition-transform duration-300 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-2xl"
      >
        {/* Handle bar (mobile only) */}
        <div className="flex justify-center py-2 lg:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 lg:pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          <button
            onClick={handleClear}
            className="text-sm text-blue-600"
          >
            Clear
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
          ) : (
            <>
              {/* Tag categories */}
              {groupedTags.map(([category, tags]) => {
                const isExpanded = expandedCategories.has(category)
                const visibleTags = isExpanded ? tags : tags.slice(0, TAGS_VISIBLE_PER_CATEGORY)
                const hiddenCount = tags.length - TAGS_VISIBLE_PER_CATEGORY

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

        {/* Apply button */}
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            onClick={handleApply}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white active:bg-blue-700"
          >
            Apply Filters
          </button>
        </div>
      </div>
    </>
  )
}
