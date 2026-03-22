import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import type { Tag, Media } from '../types'

const RECENT_SEARCHES_KEY = 'dance-library:recent-searches'
const MAX_RECENT = 10
const DEBOUNCE_MS = 200

interface SearchOverlayProps {
  isOpen: boolean
  onClose: () => void
  onApplyTagFilter: (tag: Tag) => void
  folderTagId?: string | null
  folderName?: string
}

interface VideoResult extends Media {
  tags?: { id: string; name: string }[]
}

function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function addRecentSearch(query: string) {
  if (!query.trim()) return
  const searches = getRecentSearches().filter((s) => s !== query.trim())
  searches.push(query.trim())
  if (searches.length > MAX_RECENT) searches.splice(0, searches.length - MAX_RECENT)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))
}

export default function SearchOverlay({
  isOpen,
  onClose,
  onApplyTagFilter,
  folderTagId = null,
  folderName,
}: SearchOverlayProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [videoResults, setVideoResults] = useState<VideoResult[]>([])
  const [tagResults, setTagResults] = useState<Tag[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load recent searches and auto-focus on open
  useEffect(() => {
    if (isOpen) {
      setRecentSearches(getRecentSearches())
      setQuery('')
      setVideoResults([])
      setTagResults([])
      setHasSearched(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const runSearch = useCallback(
    async (searchQuery: string) => {
      const q = searchQuery.trim()
      if (!q) {
        setVideoResults([])
        setTagResults([])
        setHasSearched(false)
        return
      }

      setSearching(true)
      setHasSearched(true)

      try {
        if (folderTagId) {
          // Scope to folder: get media_ids in folder first
          const { data: folderMediaTags } = await supabase
            .from('media_tags')
            .select('media_id')
            .eq('tag_id', folderTagId)

          const folderMediaIds = folderMediaTags?.map((mt) => mt.media_id) ?? []
          if (folderMediaIds.length === 0) {
            setVideoResults([])
            setTagResults([])
            setSearching(false)
            return
          }

          // Get media matching by title/description within folder
          const { data: directMatches } = await supabase
            .from('media')
            .select('*')
            .in('id', folderMediaIds)
            .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
            .order('created_at', { ascending: false })
            .limit(10)

          // Get media matching by tag name (within folder)
          const { data: tagNameMatches } = await supabase
            .from('tags')
            .select('id')
            .ilike('name', `%${q}%`)

          let tagMediaIds: string[] = []
          if (tagNameMatches && tagNameMatches.length > 0) {
            const { data: tagMediaTags } = await supabase
              .from('media_tags')
              .select('media_id')
              .in('tag_id', tagNameMatches.map((t) => t.id))
              .in('media_id', folderMediaIds)

            tagMediaIds = tagMediaTags?.map((mt) => mt.media_id) ?? []
          }

          // Combine and deduplicate
          const directIds = new Set((directMatches ?? []).map((m) => m.id))
          const extraIds = tagMediaIds.filter((id) => !directIds.has(id))

          let extraMedia: Media[] = []
          if (extraIds.length > 0) {
            const { data } = await supabase
              .from('media')
              .select('*')
              .in('id', extraIds)
              .order('created_at', { ascending: false })
              .limit(10 - (directMatches?.length ?? 0))
            extraMedia = data ?? []
          }

          const allMedia = [...(directMatches ?? []), ...extraMedia].slice(0, 10)
          setVideoResults(allMedia)
        } else {
          // Global search — use the query from data-architecture.md §8
          // Step 1: find media by title/description
          const { data: directMatches } = await supabase
            .from('media')
            .select('*')
            .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
            .order('created_at', { ascending: false })
            .limit(10)

          // Step 2: find media by tag name match
          const { data: tagNameMatches } = await supabase
            .from('tags')
            .select('id')
            .ilike('name', `%${q}%`)

          let tagMediaIds: string[] = []
          if (tagNameMatches && tagNameMatches.length > 0) {
            const { data: tagMediaTags } = await supabase
              .from('media_tags')
              .select('media_id')
              .in('tag_id', tagNameMatches.map((t) => t.id))

            tagMediaIds = [...new Set(tagMediaTags?.map((mt) => mt.media_id) ?? [])]
          }

          // Combine and deduplicate
          const directIds = new Set((directMatches ?? []).map((m) => m.id))
          const extraIds = tagMediaIds.filter((id) => !directIds.has(id))

          let extraMedia: Media[] = []
          if (extraIds.length > 0) {
            const { data } = await supabase
              .from('media')
              .select('*')
              .in('id', extraIds.slice(0, 10))
              .order('created_at', { ascending: false })
            extraMedia = data ?? []
          }

          const allMedia = [...(directMatches ?? []), ...extraMedia].slice(0, 10)
          setVideoResults(allMedia)
        }

        // Tag search (always global)
        const { data: matchingTags } = await supabase
          .from('tags')
          .select('*')
          .ilike('name', `%${q}%`)
          .order('name')
          .limit(20)

        setTagResults(matchingTags ?? [])
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setSearching(false)
      }
    },
    [folderTagId]
  )

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setVideoResults([])
      setTagResults([])
      setHasSearched(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      runSearch(query)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  function handleVideoClick(videoId: string) {
    addRecentSearch(query)
    setRecentSearches(getRecentSearches())
    onClose()
    navigate(`/video/${videoId}`)
  }

  function handleTagClick(tag: Tag) {
    addRecentSearch(query)
    setRecentSearches(getRecentSearches())
    onClose()
    onApplyTagFilter(tag)
  }

  function handleRecentClick(search: string) {
    setQuery(search)
    runSearch(search)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      addRecentSearch(query)
      setRecentSearches(getRecentSearches())
      runSearch(query)
    }
  }

  if (!isOpen) return null

  const placeholder = folderName ? `Search in ${folderName}...` : 'Search moves...'
  const showRecent = !query.trim() && recentSearches.length > 0
  const showEmpty = hasSearched && !searching && videoResults.length === 0 && tagResults.length === 0 && query.trim()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header with search input */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <form onSubmit={handleSubmit} className="flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </form>
        <button
          onClick={onClose}
          className="shrink-0 text-sm font-medium text-gray-500"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading spinner */}
        {searching && (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
          </div>
        )}

        {/* Recent searches */}
        {showRecent && !searching && (
          <div className="px-4 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Recent Searches
            </h3>
            <div className="flex flex-col gap-1">
              {[...recentSearches].reverse().map((search) => (
                <button
                  key={search}
                  onClick={() => handleRecentClick(search)}
                  className="rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {search}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {showEmpty && (
          <p className="px-4 py-12 text-center text-sm text-gray-400">
            No results for &lsquo;{query.trim()}&rsquo;
          </p>
        )}

        {/* Video results */}
        {!searching && videoResults.length > 0 && (
          <div className="px-4 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Videos
            </h3>
            <div className="flex flex-col gap-1">
              {videoResults.map((video) => (
                <button
                  key={video.id}
                  onClick={() => handleVideoClick(video.id)}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                >
                  <img
                    src={thumbnailUrl(video.thumbnail_path)}
                    alt=""
                    className="h-12 w-16 shrink-0 rounded bg-gray-200 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {video.title}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Divider between sections */}
        {!searching && videoResults.length > 0 && tagResults.length > 0 && (
          <div className="mx-4 border-t border-gray-100" />
        )}

        {/* Tag results */}
        {!searching && tagResults.length > 0 && (
          <div className="px-4 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Tags
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {tagResults.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleTagClick(tag)}
                  className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200"
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
