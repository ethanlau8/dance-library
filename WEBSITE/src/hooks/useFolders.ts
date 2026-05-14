import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryKeys } from '../lib/queryKeys'
import type { FolderWithCount } from '../types'

export function useFolders() {
  const query = useQuery({
    queryKey: queryKeys.folders.all,
    queryFn: async (): Promise<FolderWithCount[]> => {
      // Fetch folder tags
      const { data: tags, error: tagsError } = await supabase
        .from('tags')
        .select('id, name')
        .eq('is_folder', true)
        .order('name')

      if (tagsError) throw tagsError
      if (!tags || tags.length === 0) return []

      // Get media counts per folder tag
      const { data: mediaTags, error: mtError } = await supabase
        .from('media_tags')
        .select('tag_id, media_id')
        .in('tag_id', tags.map(t => t.id))

      if (mtError) throw mtError

      const countMap: Record<string, Set<string>> = {}
      for (const mt of mediaTags || []) {
        if (!countMap[mt.tag_id]) countMap[mt.tag_id] = new Set()
        countMap[mt.tag_id].add(mt.media_id)
      }

      return tags.map(t => ({
        id: t.id,
        name: t.name,
        video_count: countMap[t.id]?.size ?? 0,
      }))
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return { folders: query.data ?? [], loading: query.isLoading }
}
