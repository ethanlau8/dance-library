import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { FolderWithCount } from '../types'

export function useFolders() {
  const [folders, setFolders] = useState<FolderWithCount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      try {
        // Fetch folder tags and count their media
        const { data: tags, error: tagsError } = await supabase
          .from('tags')
          .select('id, name')
          .eq('is_folder', true)
          .order('name')

        if (tagsError) throw tagsError
        if (!tags || tags.length === 0) {
          setFolders([])
          setLoading(false)
          return
        }

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

        setFolders(
          tags.map(t => ({
            id: t.id,
            name: t.name,
            video_count: countMap[t.id]?.size ?? 0,
          }))
        )
      } catch (err) {
        console.error('Error fetching folders:', err)
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [])

  return { folders, loading }
}
