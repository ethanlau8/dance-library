import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useWatchProgress } from '../hooks/useWatchProgress'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import VideoPlayer from '../components/VideoPlayer'
import type { Media, Tag, TimestampTag } from '../types'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = usePermissions()

  const [media, setMedia] = useState<Media | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLevelTags, setVideoLevelTags] = useState<Tag[]>([])
  const [timestampTags, setTimestampTags] = useState<TimestampTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTimestampId, setActiveTimestampId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const { initialPosition, savePosition } = useWatchProgress(id ?? '', media?.duration ?? null)

  // Fetch media, tags, and presigned URL
  useEffect(() => {
    if (!id || !user) return
    setLoading(true)

    async function fetchAll() {
      try {
        const mediaPromise = supabase
          .from('media')
          .select('*')
          .eq('id', id!)
          .single()

        const tagsPromise = supabase
          .from('media_tags')
          .select('id, media_id, tag_id, start_time, end_time, tags(id, name, description, category_id, is_folder, tag_categories(name))')
          .eq('media_id', id!)

        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        const urlPromise = fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-media-url?media_id=${id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ).then((r) => r.json())

        const [mediaRes, tagsRes, urlRes] = await Promise.all([mediaPromise, tagsPromise, urlPromise])

        if (mediaRes.error) throw mediaRes.error
        setMedia(mediaRes.data)

        if (tagsRes.data) {
          const vTags: Tag[] = []
          const tsTags: TimestampTag[] = []

          for (const mt of tagsRes.data as any[]) {
            const tag = Array.isArray(mt.tags) ? mt.tags[0] : mt.tags
            if (!tag) continue

            const catName = tag.tag_categories
              ? Array.isArray(tag.tag_categories)
                ? tag.tag_categories[0]?.name
                : tag.tag_categories.name
              : ''

            if (mt.start_time !== null) {
              tsTags.push({
                id: mt.id,
                media_id: mt.media_id,
                tag_id: mt.tag_id,
                start_time: mt.start_time,
                end_time: mt.end_time,
                tag_name: tag.name,
                category_name: catName ?? '',
              })
            } else {
              if (!vTags.some((t) => t.id === tag.id)) {
                vTags.push(tag)
              }
            }
          }

          tsTags.sort((a, b) => a.start_time - b.start_time)
          setVideoLevelTags(vTags)
          setTimestampTags(tsTags)
        }

        if (urlRes.url) {
          setVideoUrl(urlRes.url)
        } else {
          setError('Could not load video URL')
        }
      } catch (err) {
        console.error('Error loading video detail:', err)
        setError('Failed to load video')
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [id, user])

  // Save progress every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        savePosition(videoRef.current.currentTime)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [savePosition])

  function handleTimeUpdate(currentTime: number) {
    const active = timestampTags.find(
      (t) => currentTime >= t.start_time && (t.end_time === null || currentTime <= t.end_time)
    )
    setActiveTimestampId(active?.id ?? null)
  }

  function handlePause(currentTime: number) {
    savePosition(currentTime)
  }

  function seekTo(time: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
      </div>
    )
  }

  if (error && !media) {
    return <p className="px-4 py-20 text-center text-sm text-red-500">{error}</p>
  }

  return (
    <div className="pb-8">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-700">
          ← Back
        </button>
        {can('edit_metadata') && (
          <button
            onClick={() => console.log('open edit mode')}
            className="text-sm text-blue-600"
          >
            Edit
          </button>
        )}
      </div>

      {/* Video player */}
      {videoUrl && initialPosition !== null ? (
        <VideoPlayer
          ref={videoRef}
          src={videoUrl}
          poster={thumbnailUrl(media?.thumbnail_path)}
          initialPosition={initialPosition}
          timestampMarkers={timestampTags.map((t) => ({ time: t.start_time }))}
          onTimeUpdate={handleTimeUpdate}
          onPause={handlePause}
        />
      ) : !error ? (
        <div className="flex aspect-video items-center justify-center bg-gray-200">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
        </div>
      ) : null}

      {/* Metadata */}
      {media && (
        <div className="px-4 pt-4">
          <h1 className="text-xl font-bold text-gray-900">{media.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {formatDate(media.recorded_at || media.created_at)}
            {media.duration != null && ` · ${formatTime(media.duration)}`}
          </p>
          {media.description && (
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{media.description}</p>
          )}
        </div>
      )}

      {/* Video-level tag chips */}
      {videoLevelTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 px-4">
          {videoLevelTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => navigate(`/?tag=${tag.id}`)}
              className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Timestamp tags */}
      {timestampTags.length > 0 && (
        <section className="mt-6 px-4">
          <div className="mb-3 border-t border-gray-200" />
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Timestamps</h2>
          <div className="flex flex-col gap-0.5">
            {timestampTags.map((ts) => (
              <button
                key={ts.id}
                onClick={() => seekTo(ts.start_time)}
                className={`flex items-center gap-3 rounded px-2 py-2 text-left text-sm transition-colors ${
                  activeTimestampId === ts.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="shrink-0 text-xs text-gray-400">▶</span>
                <span className="shrink-0 font-mono text-xs text-gray-500">
                  {formatTime(ts.start_time)}
                  {ts.end_time !== null && ` - ${formatTime(ts.end_time)}`}
                </span>
                <span>{ts.tag_name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Error banner (if media loaded but video URL failed) */}
      {error && media && (
        <p className="mt-4 px-4 text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  )
}
