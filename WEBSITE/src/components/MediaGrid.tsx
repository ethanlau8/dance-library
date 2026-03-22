import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import type { Media, Tag } from '../types'

interface MediaGridProps {
  media: Media[]
  viewMode: 'grid' | 'feed'
  onLoadMore: () => void
  hasMore: boolean
  mediaTags?: Record<string, Tag[]>
}

export default function MediaGrid({ media, viewMode, onLoadMore, hasMore, mediaTags }: MediaGridProps) {
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
      { rootMargin: '200px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

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
              <img
                src={thumbnailUrl(item.thumbnail_path)}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
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
                <img
                  src={thumbnailUrl(item.thumbnail_path)}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
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
