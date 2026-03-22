import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import type { Tag, TagCategory } from '../types'

interface TagWithCategory extends Tag {
  category_name: string
}

export default function TagsPage() {
  const { user } = useAuth()
  const { can } = usePermissions()
  const [tags, setTags] = useState<TagWithCategory[]>([])
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Create state
  const [showCreate, setShowCreate] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [categoryInput, setCategoryInput] = useState('')
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false)
  const [newTagDescription, setNewTagDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const categoryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [tagsRes, catsRes] = await Promise.all([
      supabase.from('tags').select('*, tag_categories(name)').order('name'),
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
    if (catsRes.data) setCategories(catsRes.data)
    setLoading(false)
  }

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags
    const q = search.toLowerCase().trim()
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const groupedTags = useMemo(() => {
    const groups: Record<string, TagWithCategory[]> = {}
    for (const tag of filteredTags) {
      const cat = tag.category_name
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tag)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredTags])

  const filteredCategories = useMemo(() => {
    if (!categoryInput.trim()) return categories
    const q = categoryInput.toLowerCase().trim()
    return categories.filter((c) => c.name.toLowerCase().includes(q))
  }, [categories, categoryInput])

  const categoryExactMatch = useMemo(() => {
    if (!categoryInput.trim()) return null
    return categories.find((c) => c.name.toLowerCase() === categoryInput.toLowerCase().trim()) ?? null
  }, [categories, categoryInput])

  // --- Folder toggle ---
  async function handleFolderToggle(tag: TagWithCategory) {
    const newValue = !tag.is_folder
    // Optimistic update
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, is_folder: newValue } : t)))

    const { error } = await supabase
      .from('tags')
      .update({ is_folder: newValue })
      .eq('id', tag.id)

    if (error) {
      // Revert on failure
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, is_folder: !newValue } : t)))
      console.error('Failed to toggle folder:', error)
    }
  }

  // --- Edit tag ---
  function startEdit(tag: TagWithCategory) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditDesc(tag.description ?? '')
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function saveEdit(tag: TagWithCategory) {
    const trimmedName = editName.trim()
    if (!trimmedName) return

    // Check for duplicate name in same category
    const duplicate = tags.find(
      (t) =>
        t.id !== tag.id &&
        t.category_id === tag.category_id &&
        t.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicate) {
      setEditError('A tag with this name already exists in this category')
      return
    }

    setSaving(true)
    setEditError(null)

    const { error } = await supabase
      .from('tags')
      .update({ name: trimmedName, description: editDesc.trim() || null })
      .eq('id', tag.id)

    if (error) {
      setEditError(error.message)
    } else {
      setTags((prev) =>
        prev.map((t) =>
          t.id === tag.id ? { ...t, name: trimmedName, description: editDesc.trim() || null } : t
        )
      )
      setEditingId(null)
    }
    setSaving(false)
  }

  // --- Create tag ---
  function openCreate() {
    setNewTagName('')
    setCategoryInput('')
    setShowCategorySuggestions(false)
    setNewTagDescription('')
    setCreateError(null)
    setShowCreate(true)
  }

  async function handleCreate() {
    if (!user || !newTagName.trim() || !categoryInput.trim()) return
    setCreating(true)
    setCreateError(null)

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

      setTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)))
      setShowCreate(false)
    } catch (err: any) {
      setCreateError(err.message ?? 'Failed to create tag')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="sticky top-14 z-20 bg-white px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Tags</h1>
          {can('create_tags') && (
            <button
              onClick={openCreate}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              + New Tag
            </button>
          )}
        </div>
        <input
          type="text"
          placeholder="Search tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Tag list */}
      <div className="px-4">
        {groupedTags.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No tags found</p>
        ) : (
          groupedTags.map(([category, catTags]) => (
            <section key={category} className="mb-5">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                {category}
              </h2>
              <div className="space-y-1">
                {catTags.map((tag) => {
                  if (editingId === tag.id) {
                    return (
                      <div key={tag.id} className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                          placeholder="Tag name"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                          placeholder="Description (optional)"
                        />
                        {editError && (
                          <p className="mb-2 text-xs text-red-600">{editError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(tag)}
                            disabled={saving || !editName.trim()}
                            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={tag.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-gray-900">{tag.name}</span>
                        {tag.description && (
                          <span className="ml-2 text-xs text-gray-400">{tag.description}</span>
                        )}
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1">
                        {can('manage_folders') && (
                          <button
                            onClick={() => handleFolderToggle(tag)}
                            title={tag.is_folder ? 'Remove from folders' : 'Make a folder'}
                            className={`flex h-8 w-8 items-center justify-center rounded text-sm transition-colors ${
                              tag.is_folder
                                ? 'text-blue-600 hover:bg-blue-50'
                                : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
                            }`}
                          >
                            &#128193;
                          </button>
                        )}
                        {can('create_tags') && (
                          <button
                            onClick={() => startEdit(tag)}
                            title="Edit tag"
                            className="flex h-8 w-8 items-center justify-center rounded text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          >
                            &#9998;
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Create tag modal */}
      {showCreate && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setShowCreate(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-white shadow-xl">
            <div className="flex justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>
            <div className="px-4 pb-2">
              <h3 className="text-lg font-semibold text-gray-900">Create Tag</h3>
            </div>
            <div className="space-y-3 px-4 pb-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
              </div>
              <div ref={categoryRef} className="relative">
                <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
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
              {createError && <p className="text-xs text-red-600">{createError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
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
    </div>
  )
}
