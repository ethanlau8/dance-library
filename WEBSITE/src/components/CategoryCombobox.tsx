import { useMemo, useRef, useState } from 'react'
import { matchCategory } from '../lib/matchCategory'
import type { TagCategory } from '../types'

interface CategoryComboboxProps {
  categories: TagCategory[]
  value: string
  onChange: (value: string) => void
  /** Show the "will be created" hint for a name that matches nothing. */
  allowCreate?: boolean
  label?: string
  autoFocus?: boolean
}

/**
 * Category picker that doubles as a "create new category" field.
 *
 * The suggestion list is rendered **in flow** rather than absolutely positioned.
 * Absolute positioning put the list directly under a field that sits near the
 * bottom of a bottom sheet, so the on-screen keyboard covered it, and it was
 * also clipped by the sheet's own scrollport. In flow it simply pushes the rest
 * of the form down and scrolls with it.
 *
 * Because the list collapses as soon as the text names a category exactly,
 * selecting an entry closes it and no outside-click handling is needed.
 */
export default function CategoryCombobox({
  categories,
  value,
  onChange,
  allowCreate = true,
  label = 'Category',
  autoFocus = false,
}: CategoryComboboxProps) {
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const exactMatch = useMemo(() => matchCategory(categories, value), [categories, value])

  const suggestions = useMemo(() => {
    if (!value.trim()) return categories
    const q = value.toLowerCase().trim()
    return categories.filter((c) => c.name.toLowerCase().includes(q))
  }, [categories, value])

  const showSuggestions = !dismissed && !exactMatch && suggestions.length > 0

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value)
          setDismissed(false)
        }}
        onFocus={() => {
          setDismissed(false)
          // The keyboard opening resizes the sheet under us; wait a frame so the
          // field is scrolled to where it actually lands.
          requestAnimationFrame(() =>
            inputRef.current?.scrollIntoView({ block: 'nearest' })
          )
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDismissed(true)
          }
        }}
        placeholder="Type to search or create"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />

      {showSuggestions && (
        <div className="mt-1 max-h-40 overflow-y-auto overscroll-contain rounded-lg border border-gray-200">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.name)
                setDismissed(true)
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {allowCreate && value.trim() && !exactMatch && (
        <p className="mt-1 text-xs text-blue-500">
          New category &ldquo;{value.trim()}&rdquo; will be created
        </p>
      )}
    </div>
  )
}
