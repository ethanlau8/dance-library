import { describe, expect, it } from 'vitest'
import {
  nextCategorySort,
  nextTagSort,
  sortCategories,
  sortTags,
  type Sort,
  type TagSortKey,
} from './tagSort'

function tag(
  name: string,
  opts: { cat?: string; used?: number; desc?: string | null; id?: string } = {}
) {
  return {
    id: opts.id ?? `${name}-${opts.cat ?? 'x'}`,
    name,
    description: opts.desc ?? null,
    category_name: opts.cat ?? 'Move',
    media_count: opts.used ?? 0,
  }
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name)
const by = (key: TagSortKey, dir: 'asc' | 'desc'): Sort<TagSortKey> => ({ key, dir })

describe('sortTags', () => {
  it('sorts by name in both directions', () => {
    const rows = [tag('zouk'), tag('bachata'), tag('salsa')]
    expect(names(sortTags(rows, by('name', 'asc')))).toEqual(['bachata', 'salsa', 'zouk'])
    expect(names(sortTags(rows, by('name', 'desc')))).toEqual(['zouk', 'salsa', 'bachata'])
  })

  it('sorts by usage numerically, not lexicographically', () => {
    // 100 vs 9 vs 20: string ordering would put "100" before "20".
    const rows = [tag('a', { used: 9 }), tag('b', { used: 100 }), tag('c', { used: 20 })]
    expect(names(sortTags(rows, by('usage', 'desc')))).toEqual(['b', 'c', 'a'])
    expect(names(sortTags(rows, by('usage', 'asc')))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by category, then by name within it', () => {
    const rows = [
      tag('zouk', { cat: 'Style' }),
      tag('copa', { cat: 'Move' }),
      tag('bachata', { cat: 'Style' }),
    ]
    expect(names(sortTags(rows, by('category', 'asc')))).toEqual(['copa', 'bachata', 'zouk'])
  })

  it('keeps tags without a description last in BOTH directions', () => {
    // 126 of 131 real tags have no description. If empties flipped to the top
    // on desc, that direction would show nothing but dashes.
    const rows = [tag('a'), tag('b', { desc: 'beta' }), tag('c'), tag('d', { desc: 'alpha' })]
    expect(names(sortTags(rows, by('description', 'asc')))).toEqual(['d', 'b', 'a', 'c'])
    expect(names(sortTags(rows, by('description', 'desc')))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('treats a whitespace-only description as absent', () => {
    const rows = [tag('a', { desc: '   ' }), tag('b', { desc: 'real' })]
    expect(names(sortTags(rows, by('description', 'asc')))).toEqual(['b', 'a'])
  })

  it('breaks ties deterministically when names repeat across categories', () => {
    // "basket" genuinely exists in two categories in this library, so name
    // alone cannot order every pair.
    const rows = [
      tag('basket', { cat: 'Lead Technique', used: 0 }),
      tag('basket', { cat: 'Follow Technique', used: 0 }),
    ]
    const once = sortTags(rows, by('usage', 'desc'))
    const twice = sortTags([...rows].reverse(), by('usage', 'desc'))
    expect(once.map((r) => r.id)).toEqual(twice.map((r) => r.id))
    expect(once[0].category_name).toBe('Follow Technique')
  })

  it('does not mutate the input array', () => {
    const rows = [tag('z'), tag('a')]
    const before = names(rows)
    sortTags(rows, by('name', 'asc'))
    expect(names(rows)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(sortTags([], by('name', 'asc'))).toEqual([])
  })
})

describe('sortCategories', () => {
  const cats = [
    { id: '1', name: 'Style', tag_count: 6 },
    { id: '2', name: 'Move', tag_count: 34 },
    { id: '3', name: 'Rhythm', tag_count: 3 },
  ]

  it('sorts by name', () => {
    expect(names(sortCategories(cats, { key: 'name', dir: 'asc' }))).toEqual([
      'Move', 'Rhythm', 'Style',
    ])
  })

  it('sorts by tag count', () => {
    expect(names(sortCategories(cats, { key: 'tags', dir: 'desc' }))).toEqual([
      'Move', 'Style', 'Rhythm',
    ])
    expect(names(sortCategories(cats, { key: 'tags', dir: 'asc' }))).toEqual([
      'Rhythm', 'Style', 'Move',
    ])
  })
})

describe('nextTagSort', () => {
  it('reverses when the active column is chosen again', () => {
    expect(nextTagSort(by('name', 'asc'), 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextTagSort(by('name', 'desc'), 'name')).toEqual({ key: 'name', dir: 'asc' })
  })

  it('opens a count column at descending and a text column at ascending', () => {
    // Sorting by usage is almost always "show me the big ones"; opening on
    // ascending would land on the 60 unused tags.
    expect(nextTagSort(by('name', 'asc'), 'usage')).toEqual({ key: 'usage', dir: 'desc' })
    expect(nextTagSort(by('usage', 'desc'), 'category')).toEqual({ key: 'category', dir: 'asc' })
  })
})

describe('nextCategorySort', () => {
  it('reverses the active column and defaults a new one', () => {
    expect(nextCategorySort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextCategorySort({ key: 'name', dir: 'asc' }, 'tags')).toEqual({ key: 'tags', dir: 'desc' })
  })
})
