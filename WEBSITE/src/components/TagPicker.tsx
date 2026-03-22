import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Tag, TagCategory } from '../types'

interface TagPickerProps {
  selectedTagIds: string[]
  onChange: (tagIds: string[]) => void
  onClose: () => void
  allowCreate: boolean
  multiSelect?: boolean
}

interface TagWithCategory extends Tag {
  category_name: string
}

export default function TagPicker({
  selectedTagIds,
  onChange,
  onClose,
  allowCreate,
  multiSelect = true,
}: TagPickerProps) {
  const { user } = useAuth()
  const [tags, setTags] = useState<TagWithCategory[]>([])
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Create form state
  const [newTagName, setNewTagName] = useState('')
  const [categoryInput, setCategoryInput] = useState('')
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false)
  const [newTagDescription, setNewTagDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [tagsRes, catsRes] = await Promise.all([
      supabase
        .from('tags')
        .select('*, tag_categories(name)')
        .order('name'),
      supabase.from('tag_categories').select('*').order('name'),
    ])

    if (tagsRes.data) {
      setTags(
        (tagsRes.data as any[]).map((t) => ({
          ...t,
          category_name: t.tag_categories?.name ?? 'Uncategorized',
        }))
      )
    }
    if (catsRes.data) {
      setCategories(catsRes.data)
    }
    setLoading(false)
  }

  const filteredTags = useMemo(() => {
    let result = tags
    if (categoryFilter !== 'all') {
      result = result.filter((t) => t.category_id === categoryFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter((t) => t.name.toLowerCase().includes(q))
    }
    return result
  }, [tags, search, categoryFilter])

  const groupedTags = useMemo(() => {
    const groups: Record<string, TagWithCategory[]> = {}
    for (const tag of filteredTags) {
      const cat = tag.category_name
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tag)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredTags])

  const hasExactMatch = useMemo(() => {
    if (!search.trim()) return true
    return tags.some((t) => t.name.toLowerCase() === search.toLowerCase().trim())
  }, [tags, search])

  function toggleTag(tagId: string) {
    if (multiSelect) {
      if (selectedTagIds.includes(tagId)) {
        onChange(selectedTagIds.filter((id) => id !== tagId))
      } else {
        onChange([...selectedTagIds, tagId])
      }
    } else {
      // Single-select: pick one and close
      onChange([tagId])
      onClose()
    }
  }

  const filteredCategories = useMemo(() => {
    if (!categoryInput.trim()) return categories
    const q = categoryInput.toLowerCase().trim()
    return categories.filter((c) => c.name.toLowerCase().includes(q))
  }, [categories, categoryInput])

  const categoryExactMatch = useMemo(() => {
    if (!categoryInput.trim()) return null
    return categories.find((c) => c.name.toLowerCase() === categoryInput.toLowerCase().trim()) ?? null
  }, [categories, categoryInput])

  function openCreateForm() {
    setNewTagName(search.trim())
    setCategoryInput('')
    setShowCategorySuggestions(false)
    setNewTagDescription('')
    setShowCreate(true)
  }

  async function handleCreateTag() {
    if (!user || !newTagName.trim() || !categoryInput.trim()) return
    setCreating(true)

    try {
      let categoryId: string

      // Use existing category if exact match, otherwise create new
      if (categoryExactMatch) {
        categoryId = categoryExactMatch.id
      } else {
        const { data: catData, error: catError } = await supabase
          .from('tag_categories')
          .insert({ name: categoryInput.trim(), created_by: user.id })
          .select()
          .single()

        if (catError) throw catError
        categoryId = catData.id
        setCategories((prev) => [...prev, catData])
      }

      const { data: tagData, error: tagError } = await supabase
        .from('tags')
        .insert({
          name: newTagName.trim(),
          description: newTagDescription.trim() || null,
          category_id: categoryId,
          is_folder: false,
          created_by: user.id,
        })
        .select('*, tag_categories(name)')
        .single()

      if (tagError) throw tagError

      const newTag: TagWithCategory = {
        ...(tagData as any),
        category_name: (tagData as any).tag_categories?.name ?? 'Uncategorized',
      }

      setTags((prev) => [...prev, newTag])
      onChange([...selectedTagIds, newTag.id])
      setShowCreate(false)
      setSearch('')
    } catch (err) {
      console.error('Failed to create tag:', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Bottom sheet / centered dialog on desktop */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl bg-white shadow-xl lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-2xl">
        {/* Handle bar (mobile only) */}
        <div className="flex justify-center py-2 lg:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 lg:pt-4">
          <h2 className="text-lg font-semibold text-gray-900">{multiSelect ? 'Select Tags' : 'Select Tag'}</h2>
          <button
            onClick={onClose}
            className="text-sm text-gray-500"
          >
            Done
          </button>
        </div>

        {/* Search + Category filter */}
        <div className="space-y-2 border-b border-gray-100 px-4 pb-3">
          <input
            type="text"
            placeholder="Search tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            autoFocus
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Tag list */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
          ) : groupedTags.length === 0 && !allowCreate ? (
            <p className="py-8 text-center text-sm text-gray-400">No tags found</p>
          ) : (
            <>
              {groupedTags.map(([category, catTags]) => (
                <div key={category} className="mb-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">
                    {category}
                  </p>
                  {catTags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id)
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center ${multiSelect ? 'rounded' : 'rounded-full'} border text-xs ${
                            selected
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-gray-300'
                          }`}
                        >
                          {selected && '✓'}
                        </span>
                        <span>{tag.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))}

              {/* Create new tag option */}
              {allowCreate && !hasExactMatch && search.trim() && (
                <button
                  onClick={openCreateForm}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-blue-600 hover:bg-blue-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-blue-400 text-xs text-blue-600">
                    +
                  </span>
                  <span>Create "{search.trim()}"</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create tag sub-sheet */}
      {showCreate && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/20"
            onClick={() => setShowCreate(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl bg-white shadow-xl lg:inset-0 lg:m-auto lg:h-fit lg:max-w-md lg:rounded-2xl">
            <div className="flex justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 pb-2">
              <h3 className="text-lg font-semibold text-gray-900">Create Tag</h3>
            </div>
            <div className="space-y-3 px-4 pb-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Name
                </label>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div ref={categoryRef} className="relative">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Category
                </label>
                <input
                  type="text"
                  value={categoryInput}
                  onChange={(e) => { setCategoryInput(e.target.value); setShowCategorySuggestions(true) }}
                  onFocus={() => setShowCategorySuggestions(true)}
                  placeholder="Type to search or create"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {showCategorySuggestions && filteredCategories.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {filteredCategories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCategoryInput(c.name); setShowCategorySuggestions(false) }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {categoryInput.trim() && !categoryExactMatch && (
                  <p className="mt-1 text-xs text-blue-500">New category "{categoryInput.trim()}" will be created</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newTagDescription}
                  onChange={(e) => setNewTagDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTag}
                  disabled={creating || !newTagName.trim() || !categoryInput.trim()}
                  className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Tag'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
