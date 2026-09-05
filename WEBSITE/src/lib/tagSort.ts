export type SortDir = 'asc' | 'desc'
export type TagSortKey = 'name' | 'description' | 'category' | 'usage'
export type CategorySortKey = 'name' | 'tags'

export interface Sort<K extends string> {
  key: K
  dir: SortDir
}

/** The minimum a row needs to be sortable — keeps this module free of hook types. */
interface SortableTag {
  id: string
  name: string
  description: string | null
  category_name: string
  media_count: number
}

interface SortableCategory {
  id: string
  name: string
  tag_count: number
}

export const TAG_SORT_LABELS: Record<TagSortKey, string> = {
  name: 'Name',
  description: 'Description',
  category: 'Category',
  usage: 'Used',
}

export const CATEGORY_SORT_LABELS: Record<CategorySortKey, string> = {
  name: 'Name',
  tags: 'Tags',
}

/**
 * Direction a column takes the first time it is chosen.
 *
 * Text reads best A→Z, but a count is almost always being asked "which are the
 * big ones" — defaulting usage to ascending would open on a wall of zeroes.
 */
export const TAG_SORT_DEFAULT_DIR: Record<TagSortKey, SortDir> = {
  name: 'asc',
  description: 'asc',
  category: 'asc',
  usage: 'desc',
}

export const CATEGORY_SORT_DEFAULT_DIR: Record<CategorySortKey, SortDir> = {
  name: 'asc',
  tags: 'desc',
}

/**
 * Name, then category, then id. Without a total order, rows that tie on the
 * chosen column are left in whatever order the previous sort produced, so the
 * table visibly reshuffles when an unrelated row changes. Tag names are only
 * unique within a category, so name alone is not enough to break every tie.
 */
function tieBreak(a: SortableTag, b: SortableTag): number {
  return (
    a.name.localeCompare(b.name) ||
    a.category_name.localeCompare(b.category_name) ||
    a.id.localeCompare(b.id)
  )
}

export function sortTags<T extends SortableTag>(rows: T[], sort: Sort<TagSortKey>): T[] {
  const mul = sort.dir === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case 'description': {
        const aEmpty = !a.description?.trim()
        const bEmpty = !b.description?.trim()
        // Most tags carry no description. Letting the empties flip to the top
        // would make one of this column's two directions useless, so they stay
        // last either way and the direction only orders the rows that have one.
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
        if (!aEmpty) {
          const c = a.description!.localeCompare(b.description!)
          if (c !== 0) return c * mul
        }
        break
      }
      case 'usage': {
        if (a.media_count !== b.media_count) {
          return (a.media_count - b.media_count) * mul
        }
        break
      }
      case 'category': {
        const c = a.category_name.localeCompare(b.category_name)
        if (c !== 0) return c * mul
        break
      }
      case 'name': {
        const c = a.name.localeCompare(b.name)
        if (c !== 0) return c * mul
        break
      }
    }
    return tieBreak(a, b)
  })
}

export function sortCategories<T extends SortableCategory>(
  rows: T[],
  sort: Sort<CategorySortKey>
): T[] {
  const mul = sort.dir === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    if (sort.key === 'tags') {
      if (a.tag_count !== b.tag_count) return (a.tag_count - b.tag_count) * mul
    } else {
      const c = a.name.localeCompare(b.name)
      if (c !== 0) return c * mul
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}

/** Clicking the active column reverses it; a new column starts at its own default. */
export function nextTagSort(current: Sort<TagSortKey>, key: TagSortKey): Sort<TagSortKey> {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key, dir: TAG_SORT_DEFAULT_DIR[key] }
}

export function nextCategorySort(
  current: Sort<CategorySortKey>,
  key: CategorySortKey
): Sort<CategorySortKey> {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key, dir: CATEGORY_SORT_DEFAULT_DIR[key] }
}
