import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export function useWatchProgress(mediaId: string, duration: number | null) {
  const { user } = useAuth()
  const [initialPosition, setInitialPosition] = useState<number | null>(null)

  useEffect(() => {
    if (!user) {
      setInitialPosition(0)
      return
    }

    async function fetch() {
      const { data, error } = await supabase
        .from('watch_progress')
        .select('position')
        .eq('user_id', user!.id)
        .eq('media_id', mediaId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching watch progress:', error)
        setInitialPosition(0)
        return
      }
      setInitialPosition(data?.position ?? 0)
    }

    fetch()
  }, [user, mediaId])

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

  return { initialPosition, savePosition }
}
