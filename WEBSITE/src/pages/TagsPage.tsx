import { useMemo, useState } from 'react'
import { usePermissions } from '../hooks/usePermissions'
import { useTagAdmin, type CategoryRow, type TagRow } from '../hooks/useTagAdmin'
import BottomSheet from '../components/BottomSheet'
import CategoryCombobox from '../components/CategoryCombobox'

type Tab = 'tags' | 'categories'
type SortKey = 'name' | 'category' | 'usage'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  category: 'Category',
  usage: 'Most used',
}

export default function TagsPage() {
  const { can } = usePermissions()
  const {
    tags,
    categories,
    isLoading,
    error,
    createTag,
    updateTag,
    moveTags,
    setFolder,
    deleteTags,
    createCategory,
    renameCategory,
    deleteCategory,
  } = useTagAdmin()

  const canEdit = can('create_tags')
  const canManageFolders = can('manage_folders')

  const [tab, setTab] = useState<Tab>('tags')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [editingTag, setEditingTag] = useState<TagRow | null>(null)
  const [creatingTag, setCreatingTag] = useState(false)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<CategoryRow | null>(null)
  const [confirmDeleteTags, setConfirmDeleteTags] = useState<TagRow[] | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const visibleTags = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = tags.filter((t) => {
      if (categoryFilter !== 'all' && t.category_id !== categoryFilter) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        t.category_name.toLowerCase().includes(q)
      )
    })

    return filtered.sort((a, b) => {
      if (sortKey === 'usage') {
        if (b.media_count !== a.media_count) return b.media_count - a.media_count
        return a.name.localeCompare(b.name)
      }
      if (sortKey === 'category') {
        const byCat = a.category_name.localeCompare(b.category_name)
        if (byCat !== 0) return byCat
        return a.name.localeCompare(b.name)
      }
      return a.name.localeCompare(b.name)
    })
  }, [tags, search, sortKey, categoryFilter])

  const visibleCategories = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? categories.filter((c) => c.name.toLowerCase().includes(q))
      : categories
    return [...filtered].sort((a, b) =>
      sortKey === 'usage' ? b.tag_count - a.tag_count : a.name.localeCompare(b.name)
    )
  }, [categories, search, sortKey])

  // Selection is drawn from every tag, not just the visible ones, so a user can
  // search, select, search again and select more before acting on the lot. The
  // delete sheet lists what is selected, so nothing acts unseen.
  const selectedTags = useMemo(
    () => tags.filter((t) => selectedIds.has(t.id)),
    [tags, selectedIds]
  )
  const allVisibleSelected =
    visibleTags.length > 0 && visibleTags.every((t) => selectedIds.has(t.id))

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleTags.map((t) => t.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function run(action: () => Promise<unknown>) {
    setRowError(null)
    try {
      await action()
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="px-4 py-12 text-center text-sm text-red-600">
        Could not load tags: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    )
  }

  return (
    <div className="pb-8">
      {/* ── Sticky toolbar ── */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white px-4 pt-3 pb-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            {(['tags', 'categories'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  clearSelection()
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  tab === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t}
                <span
                  className={`ml-1.5 text-xs ${tab === t ? 'text-gray-300' : 'text-gray-400'}`}
                >
                  {t === 'tags' ? tags.length : categories.length}
                </span>
              </button>
            ))}
          </div>

          {canEdit && (
            <button
              onClick={() =>
                tab === 'tags' ? setCreatingTag(true) : setCreatingCategory(true)
              }
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              + New {tab === 'tags' ? 'Tag' : 'Category'}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder={tab === 'tags' ? 'Search name, description, category…' : 'Search categories…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
          />
          <div className="flex gap-2">
            {tab === 'tags' && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none sm:flex-none"
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none sm:flex-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[])
                .filter((k) => tab === 'tags' || k !== 'category')
                .map((k) => (
                  <option key={k} value={k}>
                    Sort: {tab === 'categories' && k === 'usage' ? 'Most tags' : SORT_LABELS[k]}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {rowError && (
        <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{rowError}</span>
          <button onClick={() => setRowError(null)} className="shrink-0 text-red-400">
            ×
          </button>
        </div>
      )}

      {tab === 'tags' ? (
        <TagTable
          rows={visibleTags}
          categories={categories}
          canEdit={canEdit}
          canManageFolders={canManageFolders}
          selectedIds={selectedIds}
          allVisibleSelected={allVisibleSelected}
          onToggleSelected={toggleSelected}
          onToggleSelectAll={toggleSelectAll}
          onEdit={setEditingTag}
          onDelete={(tag) => setConfirmDeleteTags([tag])}
          onChangeCategory={(tag, categoryId) =>
            run(() => moveTags.mutateAsync({ ids: [tag.id], categoryId }))
          }
          onToggleFolder={(tag) =>
            run(() => setFolder.mutateAsync({ id: tag.id, isFolder: !tag.is_folder }))
          }
        />
      ) : (
        <CategoryTable
          rows={visibleCategories}
          canEdit={canEdit}
          onRename={setEditingCategory}
          onDelete={setDeletingCategory}
          onShowTags={(category) => {
            setTab('tags')
            setCategoryFilter(category.id)
            setSearch('')
          }}
        />
      )}

      {/* ── Bulk action bar ── */}
      {tab === 'tags' && selectedTags.length > 0 && canEdit && (
        <BulkActionBar
          count={selectedTags.length}
          categories={categories}
          onClear={clearSelection}
          onMove={async (categoryId) => {
            await run(() =>
              moveTags.mutateAsync({ ids: selectedTags.map((t) => t.id), categoryId })
            )
            clearSelection()
          }}
          onDelete={() => setConfirmDeleteTags(selectedTags)}
        />
      )}

      {/* ── Sheets ──
          Each is mounted only while open so its form state starts clean every
          time, rather than showing whatever was typed the previous time. */}
      {(creatingTag || editingTag) && (
        <TagFormSheet
          tag={editingTag}
          categories={categories}
          saving={createTag.isPending || updateTag.isPending}
          onClose={() => {
            setCreatingTag(false)
            setEditingTag(null)
          }}
          onSubmit={async (values) => {
            if (editingTag) {
              await updateTag.mutateAsync({
                id: editingTag.id,
                name: values.name,
                description: values.description,
                categoryId: values.categoryId,
              })
            } else {
              await createTag.mutateAsync({
                name: values.name,
                categoryName: values.categoryName,
                description: values.description,
              })
            }
          }}
        />
      )}

      {(creatingCategory || editingCategory) && (
        <CategoryFormSheet
          category={editingCategory}
          existingNames={categories.map((c) => c.name)}
          saving={createCategory.isPending || renameCategory.isPending}
          onClose={() => {
            setCreatingCategory(false)
            setEditingCategory(null)
          }}
          onSubmit={async (name) => {
            if (editingCategory) {
              await renameCategory.mutateAsync({ id: editingCategory.id, name })
            } else {
              await createCategory.mutateAsync(name)
            }
          }}
        />
      )}

      {deletingCategory && (
        <DeleteCategorySheet
          category={deletingCategory}
          otherCategories={categories.filter((c) => c.id !== deletingCategory.id)}
          deleting={deleteCategory.isPending}
          onClose={() => setDeletingCategory(null)}
          onConfirm={async (choice) => {
            await run(() =>
              deleteCategory.mutateAsync(
                choice.mode === 'reassign'
                  ? {
                      id: deletingCategory.id,
                      mode: 'reassign',
                      reassignToId: choice.reassignToId,
                    }
                  : { id: deletingCategory.id, mode: 'deleteTags' }
              )
            )
            setDeletingCategory(null)
          }}
        />
      )}

      {confirmDeleteTags && confirmDeleteTags.length > 0 && (
        <DeleteTagsSheet
          tags={confirmDeleteTags}
          deleting={deleteTags.isPending}
          onClose={() => setConfirmDeleteTags(null)}
          onConfirm={async () => {
            await run(() => deleteTags.mutateAsync(confirmDeleteTags.map((t) => t.id)))
            setConfirmDeleteTags(null)
            clearSelection()
          }}
        />
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Tags table

   One grid whose columns reflow rather than two separate layouts: on narrow
   screens the middle column stacks name / description / category / usage, and
   from `md` up the same cells line up as real spreadsheet columns.
   ────────────────────────────────────────────────────────────────────────── */

const ROW_GRID =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 ' +
  'md:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_11rem_4.5rem_auto]'

function TagTable({
  rows,
  categories,
  canEdit,
  canManageFolders,
  selectedIds,
  allVisibleSelected,
  onToggleSelected,
  onToggleSelectAll,
  onEdit,
  onDelete,
  onChangeCategory,
  onToggleFolder,
}: {
  rows: TagRow[]
  categories: CategoryRow[]
  canEdit: boolean
  canManageFolders: boolean
  selectedIds: Set<string>
  allVisibleSelected: boolean
  onToggleSelected: (id: string) => void
  onToggleSelectAll: () => void
  onEdit: (tag: TagRow) => void
  onDelete: (tag: TagRow) => void
  onChangeCategory: (tag: TagRow, categoryId: string) => void
  onToggleFolder: (tag: TagRow) => void
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">No tags found</p>
  }

  return (
    <div className="px-4">
      {/* Column headings (desktop only) */}
      <div
        className={`${ROW_GRID} hidden border-b border-gray-200 py-2 text-xs font-medium uppercase tracking-wider text-gray-400 md:grid`}
      >
        <span>
          {canEdit && (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={onToggleSelectAll}
              aria-label="Select all tags"
              className="h-4 w-4 accent-blue-600"
            />
          )}
        </span>
        <span>Name</span>
        <span>Description</span>
        <span>Category</span>
        <span className="text-right">Used</span>
        <span />
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map((tag) => {
          const selected = selectedIds.has(tag.id)
          return (
            <div
              key={tag.id}
              className={`${ROW_GRID} py-2.5 ${selected ? 'bg-blue-50/60' : ''}`}
            >
              <span className="self-start md:self-center">
                {canEdit && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelected(tag.id)}
                    aria-label={`Select ${tag.name}`}
                    className="h-4 w-4 accent-blue-600"
                  />
                )}
              </span>

              <span className="truncate text-sm text-gray-900">{tag.name}</span>

              <span className="col-start-2 truncate text-xs text-gray-400 md:col-start-3 md:text-sm">
                {tag.description || <span className="text-gray-300">—</span>}
              </span>

              <span className="col-start-2 md:col-start-4">
                {canEdit ? (
                  <select
                    value={tag.category_id}
                    onChange={(e) => onChangeCategory(tag, e.target.value)}
                    aria-label={`Category for ${tag.name}`}
                    className="w-full max-w-full truncate rounded border border-transparent bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-gray-500">{tag.category_name}</span>
                )}
              </span>

              <span className="col-start-2 text-xs text-gray-400 md:col-start-5 md:text-right md:text-sm md:text-gray-500">
                <span className="md:hidden">Used on </span>
                {tag.media_count}
                <span className="md:hidden">
                  {' '}
                  video{tag.media_count === 1 ? '' : 's'}
                </span>
              </span>

              <span className="col-start-3 row-start-1 flex items-center justify-end gap-0.5 self-start md:col-start-6 md:row-start-auto md:self-center">
                {canManageFolders && (
                  <button
                    onClick={() => onToggleFolder(tag)}
                    title={tag.is_folder ? 'Remove from folders' : 'Make a folder'}
                    aria-pressed={tag.is_folder}
                    className={`flex h-8 w-8 items-center justify-center rounded text-sm transition-colors ${
                      tag.is_folder
                        ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                        : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
                    }`}
                  >
                    &#128193;
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => onEdit(tag)}
                      title="Edit tag"
                      className="flex h-8 w-8 items-center justify-center rounded text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      &#9998;
                    </button>
                    <button
                      onClick={() => onDelete(tag)}
                      title="Delete tag"
                      className="flex h-8 w-8 items-center justify-center rounded text-sm text-gray-300 hover:bg-red-50 hover:text-red-500"
                    >
                      &times;
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function CategoryTable({
  rows,
  canEdit,
  onRename,
  onDelete,
  onShowTags,
}: {
  rows: CategoryRow[]
  canEdit: boolean
  onRename: (category: CategoryRow) => void
  onDelete: (category: CategoryRow) => void
  onShowTags: (category: CategoryRow) => void
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">No categories found</p>
  }

  return (
    <div className="px-4">
      <div className="hidden grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-3 border-b border-gray-200 py-2 text-xs font-medium uppercase tracking-wider text-gray-400 md:grid">
        <span>Name</span>
        <span className="text-right">Tags</span>
        <span />
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map((category) => (
          <div
            key={category.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 md:grid-cols-[minmax(0,1fr)_6rem_auto]"
          >
            <span className="truncate text-sm text-gray-900">{category.name}</span>

            <button
              onClick={() => onShowTags(category)}
              className="col-start-1 justify-self-start text-xs text-blue-600 hover:underline md:col-start-2 md:justify-self-end md:text-sm md:text-gray-500"
            >
              {category.tag_count} tag{category.tag_count === 1 ? '' : 's'}
            </button>

            {canEdit && (
              <span className="col-start-2 row-start-1 flex items-center justify-end gap-0.5 md:col-start-3 md:row-start-auto">
                <button
                  onClick={() => onRename(category)}
                  title="Rename category"
                  className="flex h-8 w-8 items-center justify-center rounded text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  &#9998;
                </button>
                <button
                  onClick={() => onDelete(category)}
                  title="Delete category"
                  className="flex h-8 w-8 items-center justify-center rounded text-sm text-gray-300 hover:bg-red-50 hover:text-red-500"
                >
                  &times;
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function BulkActionBar({
  count,
  categories,
  onClear,
  onMove,
  onDelete,
}: {
  count: number
  categories: CategoryRow[]
  onClear: () => void
  onMove: (categoryId: string) => void
  onDelete: () => void
}) {
  return (
    <div className="sticky bottom-0 z-30 mt-2 border-t border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">{count} selected</span>
        <select
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="">Move to category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={onDelete}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
        <button onClick={onClear} className="ml-auto text-sm text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function TagFormSheet({
  tag,
  categories,
  saving,
  onClose,
  onSubmit,
}: {
  tag: TagRow | null
  categories: CategoryRow[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: {
    name: string
    /** Used when creating: may name a category that does not exist yet. */
    categoryName: string
    /** Used when editing: always an existing category. */
    categoryId: string
    description: string
  }) => Promise<void>
}) {
  const [name, setName] = useState(tag?.name ?? '')
  const [categoryName, setCategoryName] = useState(tag?.category_name ?? '')
  const [categoryId, setCategoryId] = useState(tag?.category_id ?? '')
  const [description, setDescription] = useState(tag?.description ?? '')
  const [error, setError] = useState<string | null>(null)

  const isEdit = tag !== null
  const categoryChosen = isEdit ? !!categoryId : !!categoryName.trim()

  async function handleSubmit() {
    setError(null)
    try {
      await onSubmit({ name, categoryName, categoryId, description })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={isEdit ? 'Edit Tag' : 'Create Tag'}
      size="md"
      dismissible={!saving}
    >
      <div className="space-y-3 px-4 pb-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {isEdit ? (
          // Editing picks from what exists. Inventing a category from a typo in
          // a rename field would be a surprising side effect; "New Category" on
          // the Categories tab is the deliberate way to add one.
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <CategoryCombobox
            categories={categories}
            value={categoryName}
            onChange={setCategoryName}
          />
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !categoryChosen}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Tag'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function CategoryFormSheet({
  category,
  existingNames,
  saving,
  onClose,
  onSubmit,
}: {
  category: CategoryRow | null
  existingNames: string[]
  saving: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  const duplicate =
    name.trim().length > 0 &&
    name.trim().toLowerCase() !== (category?.name ?? '').toLowerCase() &&
    existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())

  async function handleSubmit() {
    setError(null)
    try {
      await onSubmit(name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={category ? 'Rename Category' : 'New Category'}
      size="md"
      dismissible={!saving}
    >
      <div className="space-y-3 px-4 pb-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {duplicate && (
          <p className="text-xs text-red-600">A category with this name already exists</p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || duplicate}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : category ? 'Rename' : 'Create Category'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

type DeleteChoice =
  | { mode: 'reassign'; reassignToId: string }
  | { mode: 'deleteTags' }

function DeleteCategorySheet({
  category,
  otherCategories,
  deleting,
  onClose,
  onConfirm,
}: {
  category: CategoryRow
  otherCategories: CategoryRow[]
  deleting: boolean
  onClose: () => void
  onConfirm: (choice: DeleteChoice) => Promise<void>
}) {
  const [mode, setMode] = useState<'reassign' | 'deleteTags'>('reassign')
  const [reassignToId, setReassignToId] = useState(otherCategories[0]?.id ?? '')

  const hasTags = category.tag_count > 0
  const canReassign = otherCategories.length > 0
  const effectiveMode = hasTags && canReassign ? mode : 'deleteTags'

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Delete Category"
      size="md"
      dismissible={!deleting}
    >
      <div className="px-4 pb-6">
        <p className="text-sm text-gray-600">
          Delete <strong>{category.name}</strong>?
        </p>

        {!hasTags ? (
          <p className="mt-2 text-sm text-gray-500">This category has no tags.</p>
        ) : (
          <>
            <p className="mt-2 mb-3 text-sm text-gray-500">
              It has {category.tag_count} tag{category.tag_count === 1 ? '' : 's'}. What
              should happen to {category.tag_count === 1 ? 'it' : 'them'}?
            </p>

            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${
                  effectiveMode === 'reassign'
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200'
                } ${!canReassign ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  checked={effectiveMode === 'reassign'}
                  disabled={!canReassign}
                  onChange={() => setMode('reassign')}
                  className="mt-0.5 accent-blue-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900">Move them to</span>
                  <select
                    value={reassignToId}
                    onChange={(e) => setReassignToId(e.target.value)}
                    disabled={!canReassign}
                    className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    {otherCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-gray-500">
                    Tags and everything tagged with them are kept.
                  </span>
                </span>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${
                  effectiveMode === 'deleteTags'
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  checked={effectiveMode === 'deleteTags'}
                  onChange={() => setMode('deleteTags')}
                  className="mt-0.5 accent-red-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900">Delete the tags too</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    They are removed from every video that uses them.
                  </span>
                </span>
              </label>
            </div>
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onConfirm(
                effectiveMode === 'reassign'
                  ? { mode: 'reassign', reassignToId }
                  : { mode: 'deleteTags' }
              )
            }
            disabled={deleting || (effectiveMode === 'reassign' && !reassignToId)}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete Category'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function DeleteTagsSheet({
  tags,
  deleting,
  onClose,
  onConfirm,
}: {
  tags: TagRow[]
  deleting: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const affected = tags.reduce((sum, t) => sum + t.media_count, 0)
  const single = tags.length === 1 ? tags[0] : null

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={single ? 'Delete Tag' : `Delete ${tags.length} Tags`}
      size="md"
      dismissible={!deleting}
    >
      <div className="px-4 pb-6">
        <p className="text-sm text-gray-600">
          {single ? (
            <>
              Delete <strong>{single.name}</strong>?
            </>
          ) : (
            <>Delete these {tags.length} tags?</>
          )}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {affected > 0
            ? `Used on ${affected} video${affected === 1 ? '' : 's'} in total — ${
                single ? 'it' : 'they'
              } will be removed from all of them.`
            : 'Not used on any videos.'}
        </p>

        {!single && (
          <div className="mt-3 max-h-40 overflow-y-auto overscroll-contain rounded-lg border border-gray-200 p-2">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
                >
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
