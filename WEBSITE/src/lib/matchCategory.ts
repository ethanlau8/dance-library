import type { TagCategory } from '../types'

/** The category an input string names exactly, ignoring case and surrounding space. */
export function matchCategory(
  categories: TagCategory[],
  input: string
): TagCategory | null {
  const q = input.trim().toLowerCase()
  if (!q) return null
  return categories.find((c) => c.name.toLowerCase() === q) ?? null
}
