import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys } from '../lib/queryKeys'

export function useWatchProgress(mediaId: string, duration: number | null) {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: queryKeys.watchProgress(mediaId),
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('watch_progress')
        .select('position')
        .eq('user_id', user!.id)
        .eq('media_id', mediaId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching watch progress:', error)
        return 0
      }
      return data?.position ?? 0
    },
    enabled: !!user && !!mediaId,
    staleTime: Infinity,
  })

  const savePosition = useCallback(
    (position: number) => {
      if (!user) return
      if (position <= 0) return
      if (duration !== null && position >= duration) return

      supabase
        .from('watch_progress')
        .upsert(
          {
            user_id: user.id,
            media_id: mediaId,
            position,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,media_id' }
        )
        .then(({ error }) => {
          if (error) console.error('Error saving watch progress:', error)
        })
    },
    [user, mediaId, duration]
  )

  return { initialPosition: query.data ?? null, savePosition }
}
