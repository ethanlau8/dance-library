import type { Tag } from '../types'

interface ActiveFilterChipsProps {
  activeFilters: {
    tags: Tag[]
    fromDate: string | null
    toDate: string | null
    mediaType?: string | null
  }
  onRemoveTag: (tagId: string) => void
  onClearDates: () => void
  onClearMediaType?: () => void
}

const MEDIA_TYPE_LABELS: Record<string, string> = {
  video: 'Videos',
  image: 'Images',
}

export default function ActiveFilterChips({ activeFilters, onRemoveTag, onClearDates, onClearMediaType }: ActiveFilterChipsProps) {
  const { tags, fromDate, toDate, mediaType } = activeFilters
  const hasDateFilter = fromDate || toDate
  if (tags.length === 0 && !hasDateFilter && !mediaType) return null

  const dateLabel = fromDate && toDate
    ? `${formatDate(fromDate)} – ${formatDate(toDate)}`
    : fromDate
      ? `From ${formatDate(fromDate)}`
      : `Until ${formatDate(toDate!)}`

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-2">
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onRemoveTag(tag.id)}
          className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
        >
          {tag.name}
          <span className="text-blue-400">×</span>
        </button>
      ))}
      {hasDateFilter && (
        <button
          onClick={onClearDates}
          className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
        >
          {dateLabel}
          <span className="text-blue-400">×</span>
        </button>
      )}
      {mediaType && onClearMediaType && (
        <button
          onClick={onClearMediaType}
          className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
        >
          {MEDIA_TYPE_LABELS[mediaType] ?? mediaType}
          <span className="text-blue-400">×</span>
        </button>
      )}
    </div>
  )
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
