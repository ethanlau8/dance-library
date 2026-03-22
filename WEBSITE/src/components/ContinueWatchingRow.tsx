import { useNavigate } from 'react-router-dom'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import type { ContinueWatchingItem } from '../types'

interface ContinueWatchingRowProps {
  items: ContinueWatchingItem[]
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ContinueWatchingRow({ items }: ContinueWatchingRowProps) {
  const navigate = useNavigate()

  if (items.length === 0) return null

  return (
    <section className="mb-4">
      <h2 className="mb-2 px-4 text-sm font-semibold text-gray-700">Continue Watching</h2>
      <div
        className="flex gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item) => {
          const progress = item.duration ? (item.position / item.duration) * 100 : 0
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/video/${item.id}`)}
              className="relative w-[140px] flex-shrink-0 cursor-pointer sm:w-[180px] lg:w-[200px]"
            >
              <div className="relative aspect-video w-full overflow-hidden rounded bg-gray-200">
                <img
                  src={thumbnailUrl(item.thumbnail_path)}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-400/50">
                  <div
                    className="h-full bg-white"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {/* Time label */}
                <span className="absolute bottom-1.5 left-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                  ▶ {formatTime(item.position)}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
