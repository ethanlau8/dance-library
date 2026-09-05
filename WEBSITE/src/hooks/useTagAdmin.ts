import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys } from '../lib/queryKeys'
import type { Tag, TagCategory } from '../types'

export interface TagRow extends Tag {
  category_name: string
  media_count: number
}

export interface CategoryRow extends TagCategory {
  tag_count: number
}

/** A `tags` row with its category embedded by the PostgREST join. */
interface TagWithCategoryJoin extends Tag {
  tag_categories: { id: string; name: string } | null
}

interface TagUsageRow {
  tag_id: string
  media_count: number
}

/**
 * A write blocked by RLS comes back as `{ error: null }` with zero rows
 * affected, so a caller that only checks `error` reports success for a change
 * that never happened. Asking for the rows back makes the block observable.
 */
function assertAffected<T>(rows: T[] | null, action: string): T[] {
  if (!rows || rows.length === 0) {
    throw new Error(
      `${action} failed — the change was rejected. You may not have permission.`
    )
  }
  return rows
}

function friendlyError(err: unknown, fallback: string): Error {
  const message = err instanceof Error ? err.message : String(err ?? '')
  // 23505 = unique_violation on tags(name, category_id).
  if (message.includes('duplicate key') || message.includes('23505')) {
    return new Error('A tag with that name already exists in that category.')
  }
  if (message.includes('permission')) return new Error(message)
  return new Error(message || fallback)
}

export function useTagAdmin() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags.withCategories(),
    queryFn: async (): Promise<TagWithCategoryJoin[]> => {
      const { data, error } = await supabase
        .from('tags')
        .select('*, tag_categories(id, name)')
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as TagWithCategoryJoin[]
    },
  })

  const categoriesQuery = useQuery({
    queryKey: queryKeys.tagCategories.all,
    queryFn: async (): Promise<TagCategory[]> => {
      const { data, error } = await supabase
        .from('tag_categories')
        .select('*')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const usageQuery = useQuery({
    queryKey: queryKeys.tags.usageCounts(),
    queryFn: async (): Promise<TagUsageRow[]> => {
      const { data, error } = await supabase
        .from('tag_usage_counts')
        .select('tag_id, media_count')
      if (error) throw error
      return (data ?? []) as unknown as TagUsageRow[]
    },
  })

  const usageByTagId = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of usageQuery.data ?? []) {
      // Postgres COUNT is bigint, which PostgREST serialises as a string.
      map.set(row.tag_id, Number(row.media_count) || 0)
    }
    return map
  }, [usageQuery.data])

  const tags: TagRow[] = useMemo(
    () =>
      (tagsQuery.data ?? []).map(({ tag_categories, ...tag }) => ({
        ...tag,
        category_name: tag_categories?.name ?? 'Uncategorized',
        media_count: usageByTagId.get(tag.id) ?? 0,
      })),
    [tagsQuery.data, usageByTagId]
  )

  const categories: CategoryRow[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tags) {
      counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1)
    }
    return (categoriesQuery.data ?? []).map((c) => ({
      ...c,
      tag_count: counts.get(c.id) ?? 0,
    }))
  }, [categoriesQuery.data, tags])

  /** Everything downstream of the tag vocabulary: folders row, filter panel, media joins. */
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: queryKeys.tags.all })
    qc.invalidateQueries({ queryKey: queryKeys.tagCategories.all })
    qc.invalidateQueries({ queryKey: queryKeys.folders.all })
    qc.invalidateQueries({ queryKey: queryKeys.media.all })
  }

  /** Resolves a typed category name to an id, creating the category if it is new. */
  async function resolveCategoryId(name: string): Promise<string> {
    const trimmed = name.trim()
    const existing = (categoriesQuery.data ?? []).find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (existing) return existing.id

    if (!user) throw new Error('You must be signed in.')
    const { data, error } = await supabase
      .from('tag_categories')
      .insert({ name: trimmed, created_by: user.id })
      .select()
      .single()
    if (error) throw error
    return data.id
  }

  const createTag = useMutation({
    mutationFn: async (input: {
      name: string
      categoryName: string
      description: string
    }) => {
      if (!user) throw new Error('You must be signed in.')
      try {
        const categoryId = await resolveCategoryId(input.categoryName)
        const { data, error } = await supabase
          .from('tags')
          .insert({
            name: input.name.trim(),
            description: input.description.trim() || null,
            category_id: categoryId,
            is_folder: false,
            created_by: user.id,
          })
          .select()
          .single()
        if (error) throw error
        return data as Tag
      } catch (err) {
        throw friendlyError(err, 'Failed to create tag')
      }
    },
    onSuccess: invalidateAll,
  })

  const updateTag = useMutation({
    mutationFn: async (input: {
      id: string
      name: string
      description: string
      categoryId: string
    }) => {
      try {
        const { data, error } = await supabase
          .from('tags')
          .update({
            name: input.name.trim(),
            description: input.description.trim() || null,
            category_id: input.categoryId,
          })
          .eq('id', input.id)
          .select()
        if (error) throw error
        return assertAffected(data, 'Saving the tag')[0] as Tag
      } catch (err) {
        throw friendlyError(err, 'Failed to save tag')
      }
    },
    onSuccess: invalidateAll,
  })

  const moveTags = useMutation({
    mutationFn: async (input: { ids: string[]; categoryId: string }) => {
      if (input.ids.length === 0) return []
      try {
        const { data, error } = await supabase
          .from('tags')
          .update({ category_id: input.categoryId })
          .in('id', input.ids)
          .select()
        if (error) throw error
        const moved = assertAffected(data, 'Moving the tags')
        if (moved.length !== input.ids.length) {
          throw new Error(
            `Only ${moved.length} of ${input.ids.length} tags could be moved.`
          )
        }
        return moved as Tag[]
      } catch (err) {
        throw friendlyError(err, 'Failed to move tags')
      }
    },
    onSuccess: invalidateAll,
  })

  const setFolder = useMutation({
    mutationFn: async (input: { id: string; isFolder: boolean }) => {
      try {
        const { data, error } = await supabase
          .from('tags')
          .update({ is_folder: input.isFolder })
          .eq('id', input.id)
          .select()
        if (error) throw error
        return assertAffected(data, 'Changing folder status')[0] as Tag
      } catch (err) {
        throw friendlyError(err, 'Failed to change folder status')
      }
    },
    onSuccess: invalidateAll,
  })

  const deleteTags = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return
      const { error } = await supabase.from('tags').delete().in('id', ids)
      if (error) throw friendlyError(error, 'Failed to delete tags')
    },
    onSuccess: invalidateAll,
  })

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error('You must be signed in.')
      const { data, error } = await supabase
        .from('tag_categories')
        .insert({ name: name.trim(), created_by: user.id })
        .select()
        .single()
      if (error) throw friendlyError(error, 'Failed to create category')
      return data as TagCategory
    },
    onSuccess: invalidateAll,
  })

  const renameCategory = useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      try {
        const { data, error } = await supabase
          .from('tag_categories')
          .update({ name: input.name.trim() })
          .eq('id', input.id)
          .select()
        if (error) throw error
        return assertAffected(data, 'Renaming the category')[0] as TagCategory
      } catch (err) {
        throw friendlyError(err, 'Failed to rename category')
      }
    },
    onSuccess: invalidateAll,
  })

  /**
   * Deleting a category must say what happens to its tags. `reassign` keeps them
   * (and everything tagged with them) by moving them elsewhere first;
   * `deleteTags` removes them from every video they are on.
   */
  const deleteCategory = useMutation({
    mutationFn: async (
      input:
        | { id: string; mode: 'reassign'; reassignToId: string }
        | { id: string; mode: 'deleteTags' }
    ) => {
      const doomedTagIds = tags
        .filter((t) => t.category_id === input.id)
        .map((t) => t.id)

      try {
        if (doomedTagIds.length > 0) {
          if (input.mode === 'reassign') {
            const { data, error } = await supabase
              .from('tags')
              .update({ category_id: input.reassignToId })
              .in('id', doomedTagIds)
              .select()
            if (error) throw error
            assertAffected(data, 'Moving the tags')
          } else {
            const { error } = await supabase
              .from('tags')
              .delete()
              .in('id', doomedTagIds)
            if (error) throw error
          }
        }

        const { data, error } = await supabase
          .from('tag_categories')
          .delete()
          .eq('id', input.id)
          .select()
        if (error) throw error
        assertAffected(data, 'Deleting the category')
      } catch (err) {
        throw friendlyError(err, 'Failed to delete category')
      }
    },
    onSuccess: invalidateAll,
  })

  return {
    tags,
    categories,
    isLoading:
      tagsQuery.isLoading || categoriesQuery.isLoading || usageQuery.isLoading,
    error: tagsQuery.error ?? categoriesQuery.error ?? usageQuery.error,
    createTag,
    updateTag,
    moveTags,
    setFolder,
    deleteTags,
    createCategory,
    renameCategory,
    deleteCategory,
  }
}
