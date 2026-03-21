import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMedia, type SortBy } from '../hooks/useMedia'
import MediaGrid from '../components/MediaGrid'
import ActiveFilterChips from '../components/ActiveFilterChips'
import type { Tag } from '../types'

const VIEW_MODE_KEY = 'dance-library:view-mode'

export default function FolderPage() {
  const { tagId } = useParams<{ tagId: string }>()
  const navigate = useNavigate()

  const [folderName, setFolderName] = useState('')
  const [folderLoading, setFolderLoading] = useState(true)

  const [viewMode, setViewMode] = useState<'grid' | 'feed'>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    return saved === 'feed' ? 'feed' : 'grid'
  })
  const [sortBy, setSortBy] = useState<SortBy>('upload_date')
  const [activeTagFilters, setActiveTagFilters] = useState<Tag[]>([])
  const [activeDateRange, setActiveDateRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  })

  const { media, totalCount, loading, hasMore, loadMore, mediaTags } = useMedia({
    sortBy,
    tagFilters: activeTagFilters,
    fromDate: activeDateRange.from,
    toDate: activeDateRange.to,
    folderTagId: tagId ?? null,
  })

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  // Fetch folder info
  useEffect(() => {
    if (!tagId) return
    async function fetchFolder() {
      setFolderLoading(true)
      const { data, error } = await supabase
        .from('tags')
        .select('name')
        .eq('id', tagId!)
        .single()

      if (error) {
        console.error('Error fetching folder:', error)
      } else if (data) {
        setFolderName(data.name)
      }
      setFolderLoading(false)
    }
    fetchFolder()
  }, [tagId])

  function handleRemoveTag(tagId: string) {
    setActiveTagFilters((prev) => prev.filter((t) => t.id !== tagId))
  }

  function handleClearDates() {
    setActiveDateRange({ from: null, to: null })
  }

  if (folderLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  return (
    <div className="pb-8">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => navigate('/')} className="text-gray-700">
          ←
        </button>
        <h1 className="text-lg font-bold text-gray-900">
          {folderName} ({totalCount})
        </h1>
      </div>

      {/* Search bar stub (scoped) */}
      <div className="px-4 pb-2">
        <button
          onClick={() => console.log('open search in folder:', folderName)}
          className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-left text-sm text-gray-400"
        >
          Search in {folderName}...
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded border border-gray-300">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2 py-1 text-xs ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              ▦
            </button>
            <button
              onClick={() => setViewMode('feed')}
              className={`px-2 py-1 text-xs ${viewMode === 'feed' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              ▤
            </button>
          </div>

          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
          >
            <option value="upload_date">Upload date</option>
            <option value="recorded_date">Recorded date</option>
            <option value="alphabetical">A-Z</option>
          </select>

          {/* Filters button stub */}
          <button
            onClick={() => console.log('open filters')}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
          >
            Filters
          </button>
        </div>
      </div>

      {/* Active filter chips */}
      <ActiveFilterChips
        activeFilters={{
          tags: activeTagFilters,
          fromDate: activeDateRange.from,
          toDate: activeDateRange.to,
        }}
        onRemoveTag={handleRemoveTag}
        onClearDates={handleClearDates}
      />

      {/* Media grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
        </div>
      ) : media.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-gray-400">No videos in this folder</p>
      ) : (
        <MediaGrid
          media={media}
          viewMode={viewMode}
          onLoadMore={loadMore}
          hasMore={hasMore}
          mediaTags={mediaTags}
        />
      )}
    </div>
  )
}
