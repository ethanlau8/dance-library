import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys } from '../lib/queryKeys'
import type { ContinueWatchingItem } from '../types'

export function useContinueWatching() {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: queryKeys.continueWatching(user?.id ?? ''),
    queryFn: async (): Promise<ContinueWatchingItem[]> => {
      const { data, error } = await supabase
        .from('watch_progress')
        .select('position, updated_at, media(id, title, thumbnail_path, duration)')
        .eq('user_id', user!.id)
        .gt('position', 0)
        .order('updated_at', { ascending: false })
        .limit(10)

      if (error) throw error

      const results: ContinueWatchingItem[] = []
      for (const row of data || []) {
        const m = row.media as unknown as {
          id: string
          title: string
          thumbnail_path: string | null
          duration: number | null
        }
        if (!m || m.duration === null || row.position >= m.duration) continue
        results.push({
          id: m.id,
          title: m.title,
          thumbnail_path: m.thumbnail_path,
          duration: m.duration,
          position: row.position,
          updated_at: row.updated_at,
        })
      }

      return results
    },
    enabled: !!user,
    staleTime: 30 * 1000, // 30 seconds
  })

  return { items: query.data ?? [], loading: query.isLoading }
}
