import { describe, expect, it } from 'vitest'
import { matchCategory } from './matchCategory'
import type { TagCategory } from '../types'

function category(name: string, id = name.toLowerCase()): TagCategory {
  return { id, name, created_by: 'u1', created_at: '2026-01-01T00:00:00Z' }
}

const categories = [category('Style'), category('Move'), category('Difficulty')]

describe('matchCategory', () => {
  it('finds an exact name', () => {
    expect(matchCategory(categories, 'Move')?.id).toBe('move')
  })

  it('ignores case', () => {
    expect(matchCategory(categories, 'sTyLe')?.id).toBe('style')
  })

  it('ignores surrounding whitespace', () => {
    expect(matchCategory(categories, '  Difficulty  ')?.id).toBe('difficulty')
  })

  it('does not match on a prefix', () => {
    // "Sty" must read as a new category, not as a hit on "Style" — otherwise
    // typing toward a new name would silently reuse an existing category.
    expect(matchCategory(categories, 'Sty')).toBeNull()
  })

  it('does not match on a substring', () => {
    expect(matchCategory(categories, 'ove')).toBeNull()
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(matchCategory(categories, '')).toBeNull()
    expect(matchCategory(categories, '   ')).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchCategory(categories, 'Tempo')).toBeNull()
  })

  it('handles an empty category list', () => {
    expect(matchCategory([], 'Style')).toBeNull()
  })
})
