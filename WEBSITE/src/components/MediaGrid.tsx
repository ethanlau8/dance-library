import { useEffect, useRef, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import LazyImage from './LazyImage'
import type { Media, Tag } from '../types'

interface MediaGridProps {
  media: Media[]
  viewMode: 'grid' | 'feed'
  onLoadMore: () => void
  hasMore: boolean
  mediaTags?: Record<string, Tag[]>
  scrollRef?: RefObject<HTMLDivElement | null>
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function MediaGrid({ media, viewMode, onLoadMore, hasMore, mediaTags, scrollRef }: MediaGridProps) {
  const navigate = useNavigate()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          onLoadMore()
        }
      },
      { rootMargin: '200px', root: scrollRef?.current ?? null }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore, scrollRef])

  if (viewMode === 'grid') {
    return (
      <div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" style={{ gap: '1px' }}>
          {media.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/video/${item.id}`)}
              className="relative aspect-square cursor-pointer overflow-hidden bg-gray-200"
            >
              <LazyImage
                src={thumbnailUrl(item.thumbnail_path)}
                alt={item.title}
                className="h-full w-full"
              />
              {item.duration != null && item.duration > 0 && (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                  {formatDuration(item.duration)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div ref={sentinelRef} className="h-4" />
      </div>
    )
  }

  // Feed view
  return (
    <div>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4">
        {media.map((item) => {
          const tags = mediaTags?.[item.id] || []
          const displayDate = item.recorded_at || item.created_at
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/video/${item.id}`)}
              className="w-full cursor-pointer text-left"
            >
              <div className="relative aspect-video w-full overflow-hidden rounded bg-gray-200">
                <LazyImage
                  src={thumbnailUrl(item.thumbnail_path)}
                  alt={item.title}
                  className="h-full w-full"
                />
                {item.duration != null && item.duration > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 text-[11px] font-medium text-white">
                    {formatDuration(item.duration)}
                  </span>
                )}
              </div>
              <h3 className="mt-2 font-medium text-gray-900">{item.title}</h3>
              {tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {new Date(displayDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </button>
          )
        })}
      </div>
      <div ref={sentinelRef} className="h-4" />
    </div>
  )
}
