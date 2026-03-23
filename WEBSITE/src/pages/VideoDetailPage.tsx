import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useWatchProgress } from '../hooks/useWatchProgress'
import { thumbnailUrl } from '../lib/thumbnailUrl'
import { generateThumbnail } from '../lib/ffmpeg'
import VideoPlayer from '../components/VideoPlayer'
import TagPicker from '../components/TagPicker'
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

function parseTimeInput(value: string): number | null {
  const num = parseFloat(value)
  return isNaN(num) || num < 0 ? null : num
}

// Temporary ID prefix for new items not yet saved to DB
const TEMP_ID_PREFIX = '_temp_'
let tempIdCounter = 0
function makeTempId() {
  return TEMP_ID_PREFIX + (++tempIdCounter)
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = usePermissions()

  // --- Core data state ---
  const [media, setMedia] = useState<Media | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLevelTags, setVideoLevelTags] = useState<Tag[]>([])
  const [timestampTags, setTimestampTags] = useState<TimestampTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTimestampId, setActiveTimestampId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const { initialPosition, savePosition } = useWatchProgress(id ?? '', media?.duration ?? null)

  // --- Edit mode state ---
  const [isEditMode, setIsEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Editable field drafts
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editRecordedDate, setEditRecordedDate] = useState('')

  // Editable tag drafts
  const [editTagIds, setEditTagIds] = useState<string[]>([])
  const [editTags, setEditTags] = useState<Tag[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)

  // Editable timestamp drafts
  const [editTimestamps, setEditTimestamps] = useState<TimestampTag[]>([])

  // Timestamp creation flow
  const [tsCreationStep, setTsCreationStep] = useState<'idle' | 'set-start' | 'set-end' | 'pick-tag'>('idle')
  const [tsNewStart, setTsNewStart] = useState<number>(0)
  const [tsNewEnd, setTsNewEnd] = useState<number>(0)

  // Timestamp edit sheet
  const [editingTimestamp, setEditingTimestamp] = useState<TimestampTag | null>(null)
  const [editTsStart, setEditTsStart] = useState('')
  const [editTsEnd, setEditTsEnd] = useState('')
  const [showTsTagPicker, setShowTsTagPicker] = useState(false)
  const [editTsTagId, setEditTsTagId] = useState('')

  // Replace video state
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [replaceProgress, setReplaceProgress] = useState(0)
  const [replacing, setReplacing] = useState(false)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Desktop detection for side-by-side layout
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // --- Fetch data ---
  const fetchAll = useCallback(async () => {
    if (!id || !user) return
    setLoading(true)

    try {
      const mediaPromise = supabase
        .from('media')
        .select('*')
        .eq('id', id)
        .single()

      const tagsPromise = supabase
        .from('media_tags')
        .select('id, media_id, tag_id, start_time, end_time, tags(id, name, description, category_id, is_folder, tag_categories(name))')
        .eq('media_id', id)

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
      } else if (mediaRes.data?.media_type !== 'image') {
        setError('Could not load video URL')
      }
    } catch (err) {
      console.error('Error loading video detail:', err)
      setError('Failed to load video')
    } finally {
      setLoading(false)
    }
  }, [id, user])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Save progress every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        savePosition(videoRef.current.currentTime)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [savePosition])

  // Fetch tag details when edit tag IDs change
  useEffect(() => {
    if (!isEditMode) return
    if (editTagIds.length === 0) {
      setEditTags([])
      return
    }
    supabase
      .from('tags')
      .select('*')
      .in('id', editTagIds)
      .then(({ data }) => {
        if (data) setEditTags(data)
      })
  }, [editTagIds, isEditMode])

  function handleTimeUpdate(currentTime: number) {
    const tags = isEditMode ? editTimestamps : timestampTags
    const active = tags.find(
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

  // --- Edit mode enter/cancel ---
  function enterEditMode() {
    if (!media) return
    setEditTitle(media.title)
    setEditDescription(media.description ?? '')
    setEditRecordedDate(
      media.recorded_at ? media.recorded_at.split('T')[0] : ''
    )
    setEditTagIds(videoLevelTags.map((t) => t.id))
    setEditTags([...videoLevelTags])
    setEditTimestamps([...timestampTags])
    setEditError(null)
    setTsCreationStep('idle')
    setEditingTimestamp(null)
    setIsEditMode(true)
  }

  function cancelEditMode() {
    setIsEditMode(false)
    setEditError(null)
    setTsCreationStep('idle')
    setEditingTimestamp(null)
    setShowTagPicker(false)
    setShowTsTagPicker(false)
  }

  // --- Save ---
  async function handleSave() {
    if (!media || !id || !user) return
    if (!editTitle.trim()) {
      setEditError('Title is required')
      return
    }

    setSaving(true)
    setEditError(null)

    try {
      // 1. Compute metadata diff
      const metadata: Record<string, unknown> = {}
      if (editTitle.trim() !== media.title) metadata.title = editTitle.trim()
      if ((editDescription.trim() || null) !== media.description) {
        metadata.description = editDescription.trim() || null
      }
      const newRecordedAt = editRecordedDate
        ? new Date(editRecordedDate).toISOString()
        : null
      if (newRecordedAt !== media.recorded_at) {
        metadata.recorded_at = newRecordedAt
      }

      // 2. Compute video-level tag diff
      const originalTagIds = videoLevelTags.map((t) => t.id)
      const removedTagIds = originalTagIds.filter((tid) => !editTagIds.includes(tid))
      const addedTagIds = editTagIds.filter((tid) => !originalTagIds.includes(tid))

      // 3. Compute timestamp diff
      const originalTsIds = timestampTags.map((t) => t.id)
      const currentTsIds = editTimestamps.map((t) => t.id)
      const deletedTsIds = originalTsIds.filter((tsId) => !currentTsIds.includes(tsId))

      const newTimestamps = editTimestamps
        .filter((t) => t.id.startsWith(TEMP_ID_PREFIX))
        .map((t) => ({
          tag_id: t.tag_id,
          start_time: t.start_time,
          end_time: t.end_time,
        }))

      const modifiedTimestamps = editTimestamps
        .filter((t) => {
          if (t.id.startsWith(TEMP_ID_PREFIX)) return false
          if (!originalTsIds.includes(t.id)) return false
          const original = timestampTags.find((o) => o.id === t.id)
          return (
            original &&
            (original.start_time !== t.start_time ||
              original.end_time !== t.end_time ||
              original.tag_id !== t.tag_id)
          )
        })
        .map((t) => ({
          id: t.id,
          tag_id: t.tag_id,
          start_time: t.start_time,
          end_time: t.end_time,
        }))

      // 4. Build payload (only include sections with actual changes)
      const payload: Record<string, unknown> = { media_id: id }

      if (Object.keys(metadata).length > 0) {
        payload.metadata = metadata
      }
      if (removedTagIds.length > 0 || addedTagIds.length > 0) {
        payload.tags = { added: addedTagIds, removed: removedTagIds }
      }
      if (deletedTsIds.length > 0 || newTimestamps.length > 0 || modifiedTimestamps.length > 0) {
        payload.timestamps = {
          added: newTimestamps,
          modified: modifiedTimestamps,
          removed: deletedTsIds,
        }
      }

      // 5. Call edge function
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Save failed with status ${res.status}`)
      }

      // Re-fetch and exit edit mode
      setIsEditMode(false)
      await fetchAll()
    } catch (err) {
      console.error('Save error:', err)
      setEditError(
        err instanceof Error ? err.message : 'Failed to save changes'
      )
    } finally {
      setSaving(false)
    }
  }

  // --- Tag management ---
  function handleEditTagsChange(tagIds: string[]) {
    setEditTagIds(tagIds)
  }

  function removeEditTag(tagId: string) {
    setEditTagIds((prev) => prev.filter((id) => id !== tagId))
  }

  // --- Timestamp management ---
  function removeTimestamp(tsId: string) {
    setEditTimestamps((prev) => prev.filter((t) => t.id !== tsId))
  }

  function startAddTimestamp() {
    setTsCreationStep('set-start')
  }

  function handleSetStart() {
    const time = videoRef.current?.currentTime ?? 0
    setTsNewStart(time)
    setTsCreationStep('set-end')
  }

  function handleSetEnd() {
    const time = videoRef.current?.currentTime ?? 0
    setTsNewEnd(Math.max(time, tsNewStart))
    setTsCreationStep('pick-tag')
    setShowTsTagPicker(true)
  }

  function handleNewTimestampTagSelected(tagIds: string[]) {
    if (tagIds.length === 0) return
    const tagId = tagIds[0]

    // We need the tag name for display — fetch it
    supabase
      .from('tags')
      .select('name, tag_categories(name)')
      .eq('id', tagId)
      .single()
      .then(({ data }) => {
        if (!data) return
        const catName = (data as any).tag_categories?.name ?? ''
        const newTs: TimestampTag = {
          id: makeTempId(),
          media_id: id!,
          tag_id: tagId,
          start_time: tsNewStart,
          end_time: tsNewEnd,
          tag_name: (data as any).name,
          category_name: catName,
        }
        setEditTimestamps((prev) =>
          [...prev, newTs].sort((a, b) => a.start_time - b.start_time)
        )
      })

    setShowTsTagPicker(false)
    setTsCreationStep('idle')
  }

  function openEditTimestamp(ts: TimestampTag) {
    setEditingTimestamp(ts)
    setEditTsStart(String(Math.round(ts.start_time * 10) / 10))
    setEditTsEnd(ts.end_time !== null ? String(Math.round(ts.end_time * 10) / 10) : '')
    setEditTsTagId(ts.tag_id)
  }

  function saveEditTimestamp() {
    if (!editingTimestamp) return
    const startVal = parseTimeInput(editTsStart)
    if (startVal === null) return

    const endVal = editTsEnd.trim() ? parseTimeInput(editTsEnd) : null

    setEditTimestamps((prev) =>
      prev
        .map((t) =>
          t.id === editingTimestamp.id
            ? { ...t, start_time: startVal, end_time: endVal, tag_id: editTsTagId || t.tag_id }
            : t
        )
        .sort((a, b) => a.start_time - b.start_time)
    )
    setEditingTimestamp(null)
  }

  function handleEditTsTagSelected(tagIds: string[]) {
    if (tagIds.length === 0) return
    const tagId = tagIds[0]
    setEditTsTagId(tagId)

    // Update the tag name on the editing timestamp
    supabase
      .from('tags')
      .select('name, tag_categories(name)')
      .eq('id', tagId)
      .single()
      .then(({ data }) => {
        if (!data) return
        const catName = (data as any).tag_categories?.name ?? ''
        setEditTimestamps((prev) =>
          prev.map((t) =>
            t.id === editingTimestamp?.id
              ? { ...t, tag_id: tagId, tag_name: (data as any).name, category_name: catName }
              : t
          )
        )
        setEditingTimestamp((prev) =>
          prev ? { ...prev, tag_id: tagId, tag_name: (data as any).name, category_name: catName } : prev
        )
      })

    setShowTsTagPicker(false)
  }

  // --- Replace video ---
  async function handleReplaceFile(selectedFile: File) {
    if (!id || !user || !media) return
    setReplaceFile(selectedFile)
    setReplacing(true)
    setReplaceProgress(0)
    setEditError(null)

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      // Generate thumbnail and get duration via canvas
      const thumbResult = await generateThumbnail(selectedFile).catch(() => null)
      const thumbBlob = thumbResult?.blob ?? null
      const newDuration = thumbResult?.duration ?? null

      // Get presigned upload URLs
      const mediaType = selectedFile.type.startsWith('video/')
        ? 'video'
        : selectedFile.type.startsWith('image/')
        ? 'image'
        : 'other'

      const urlRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-upload-url`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: selectedFile.name,
            content_type: selectedFile.type,
            type: mediaType,
          }),
        }
      )

      if (!urlRes.ok) {
        throw new Error(`Failed to get upload URL: ${await urlRes.text()}`)
      }

      const {
        media_upload_url,
        media_storage_path,
        thumbnail_upload_url,
        thumbnail_storage_path,
      } = await urlRes.json()

      // Upload new file with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setReplaceProgress(Math.round((e.loaded / e.total) * 90))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed: ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('PUT', media_upload_url)
        xhr.setRequestHeader('Content-Type', selectedFile.type)
        xhr.send(selectedFile)
      })

      // Upload thumbnail
      let finalThumbPath = thumbnail_storage_path
      if (thumbBlob && thumbnail_upload_url) {
        const thumbRes = await fetch(thumbnail_upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/webp' },
          body: thumbBlob,
        })
        if (!thumbRes.ok) {
          finalThumbPath = media.thumbnail_path ?? thumbnail_storage_path
        }
      }

      setReplaceProgress(95)

      // Call replace-media edge function
      const replaceRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/replace-media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            media_id: id,
            new_storage_path: media_storage_path,
            new_thumbnail_path: finalThumbPath,
            duration: newDuration ? Math.round(newDuration) : undefined,
          }),
        }
      )

      if (!replaceRes.ok) {
        throw new Error(`Replace failed: ${await replaceRes.text()}`)
      }

      setReplaceProgress(100)

      // Re-fetch video URL and media data
      const newUrlRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-media-url?media_id=${id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => r.json())

      if (newUrlRes.url) {
        setVideoUrl(newUrlRes.url)
      }

      // Re-fetch media record for updated paths/duration
      const { data: updatedMedia } = await supabase
        .from('media')
        .select('*')
        .eq('id', id)
        .single()
      if (updatedMedia) {
        setMedia(updatedMedia)
        // Update edit fields with new data
        if (newDuration) {
          // duration already updated on server
        }
      }
    } catch (err) {
      console.error('Replace error:', err)
      setEditError(
        err instanceof Error ? err.message : 'Failed to replace video'
      )
    } finally {
      setReplacing(false)
      setReplaceFile(null)
      setReplaceProgress(0)
    }
  }

  // --- Delete media ---
  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ media_id: id }),
        }
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Delete failed with status ${res.status}`)
      }

      navigate('/')
    } catch (err) {
      console.error('Delete error:', err)
      setEditError(
        err instanceof Error ? err.message : 'Failed to delete'
      )
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // --- Render ---
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

  const displayTimestamps = isEditMode ? editTimestamps : timestampTags
  const canDelete =
    can('delete_media') || (media && user && media.uploaded_by === user.id)

  return (
    <div className="pb-8">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        {isEditMode ? (
          <>
            <button
              onClick={cancelEditMode}
              disabled={saving}
              className="text-sm text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium text-blue-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => navigate(-1)} className="text-sm text-gray-700">
              ← Back
            </button>
            {can('edit_metadata') && (
              <button
                onClick={enterEditMode}
                className="text-sm text-blue-600"
              >
                Edit
              </button>
            )}
          </>
        )}
      </div>

      {/* Edit error banner */}
      {editError && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {editError}
        </div>
      )}

      {/* Side-by-side layout on desktop */}
      <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-6 lg:px-4">
        {/* Left column: Video player */}
        <div className="lg:sticky lg:top-14 lg:self-start">
          {/* Media display: image or video player */}
          {media?.media_type === 'image' ? (
            <div className="flex w-full items-center justify-center bg-black">
              <img
                src={thumbnailUrl(media.thumbnail_path)}
                alt={media.title}
                className="w-full object-contain max-h-[60vh] lg:max-h-[80vh]"
              />
            </div>
          ) : videoUrl && initialPosition !== null ? (
            <div className="relative">
              <VideoPlayer
                ref={videoRef}
                src={videoUrl}
                poster={thumbnailUrl(media?.thumbnail_path)}
                initialPosition={initialPosition}
                timestampMarkers={displayTimestamps.map((t) => ({ time: t.start_time }))}
                onTimeUpdate={handleTimeUpdate}
                onPause={handlePause}
                disableSticky={isDesktop}
              />

              {/* Timestamp seek overlay */}
              {isEditMode && tsCreationStep !== 'idle' && (
                <div className="bg-black/70 px-4 py-3 text-center">
                  {tsCreationStep === 'set-start' && (
                    <>
                      <p className="mb-2 text-sm text-white">
                        Play or scrub to the start of the moment
                      </p>
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => setTsCreationStep('idle')}
                          className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSetStart}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                        >
                          Set Start
                        </button>
                      </div>
                    </>
                  )}
                  {tsCreationStep === 'set-end' && (
                    <>
                      <p className="mb-1 text-xs text-white/60">
                        Start: {formatTime(tsNewStart)}
                      </p>
                      <p className="mb-2 text-sm text-white">
                        Now scrub to the end of the moment
                      </p>
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => setTsCreationStep('idle')}
                          className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSetEnd}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                        >
                          Set End
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : !error ? (
            <div className="flex aspect-video items-center justify-center bg-gray-200">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
          ) : null}
        </div>

        {/* Right column: Metadata & edit controls */}
        <div>
          {/* Metadata */}
          {media && (
            <div className="px-4 pt-4 lg:px-0">
              {isEditMode ? (
                <>
                  {/* Editable title */}
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full text-xl font-bold text-gray-900 border-b border-gray-200 pb-1 focus:border-blue-500 focus:outline-none bg-transparent"
                  />

                  {/* Editable recorded date */}
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Recorded Date
                    </label>
                    <input
                      type="date"
                      value={editRecordedDate}
                      onChange={(e) => setEditRecordedDate(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Editable description */}
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Description
                    </label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Optional description"
                      rows={3}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <h1 className="text-xl font-bold text-gray-900">{media.title}</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    {formatDate(media.recorded_at || media.created_at)}
                    {media.duration != null && ` · ${formatTime(media.duration)}`}
                  </p>
                  {media.description && (
                    <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{media.description}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Video-level tags */}
          {isEditMode ? (
            <div className="mt-3 px-4 lg:px-0">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Tags
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {editTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-2.5 pr-1.5 text-xs text-gray-600"
                  >
                    {tag.name}
                    <button
                      onClick={() => removeEditTag(tag.id)}
                      className="ml-0.5 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setShowTagPicker(true)}
                  className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-400"
                >
                  + Add Tag
                </button>
              </div>
            </div>
          ) : videoLevelTags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5 px-4 lg:px-0">
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
          ) : null}

          {/* Timestamp tags */}
          {(displayTimestamps.length > 0 || isEditMode) && (
            <section className="mt-6 px-4 lg:px-0">
              <div className="mb-3 border-t border-gray-200" />
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Timestamps</h2>
              <div className="flex flex-col gap-0.5">
                {displayTimestamps.map((ts) => (
                  <div
                    key={ts.id}
                    className={`flex items-center gap-2 rounded px-2 py-2 text-sm transition-colors ${
                      activeTimestampId === ts.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => seekTo(ts.start_time)}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <span className="shrink-0 text-xs text-gray-400">▶</span>
                      <span className="shrink-0 font-mono text-xs text-gray-500">
                        {formatTime(ts.start_time)}
                        {ts.end_time !== null && ` - ${formatTime(ts.end_time)}`}
                      </span>
                      <span>{ts.tag_name}</span>
                    </button>
                    {isEditMode && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => openEditTimestamp(ts)}
                          className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                        >
                          edit
                        </button>
                        <button
                          onClick={() => removeTimestamp(ts.id)}
                          className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                        >
                          del
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isEditMode && tsCreationStep === 'idle' && media?.media_type !== 'image' && (
                <button
                  onClick={startAddTimestamp}
                  className="mt-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-gray-400 w-full text-left"
                >
                  + Add timestamp tag
                </button>
              )}
            </section>
          )}

          {/* Replace Video File (edit mode only, videos only) */}
          {isEditMode && media?.media_type !== 'image' && (
            <section className="mt-6 px-4 lg:px-0">
              <div className="mb-3 border-t border-gray-200" />
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Replace Video File</h2>

              {replacing ? (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>Uploading replacement…</span>
                    <span>{replaceProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${replaceProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => replaceInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Choose new file
                  </button>
                  <input
                    ref={replaceInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleReplaceFile(f)
                      e.target.value = ''
                    }}
                  />
                  {replaceFile && (
                    <p className="mt-1 text-xs text-gray-500">
                      Selected: {replaceFile.name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    This will upload immediately and replace the current file.
                  </p>
                </>
              )}
            </section>
          )}

          {/* Danger Zone (edit mode only) */}
          {isEditMode && canDelete && (
            <section className="mt-6 px-4 lg:px-0">
              <div className="mb-3 border-t border-red-200" />
              <h2 className="mb-2 text-sm font-semibold text-red-600">Danger Zone</h2>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-100"
              >
                Delete this {media?.media_type === 'image' ? 'image' : 'video'}
              </button>
            </section>
          )}

          {/* Error banner (if media loaded but video URL failed) */}
          {error && media && !isEditMode && (
            <p className="mt-4 px-4 text-center text-sm text-red-500 lg:px-0">{error}</p>
          )}
        </div>
      </div>

      {/* Tag Picker bottom sheet (video-level tags) */}
      {showTagPicker && (
        <TagPicker
          selectedTagIds={editTagIds}
          onChange={handleEditTagsChange}
          onClose={() => setShowTagPicker(false)}
          allowCreate={can('create_tags')}
          multiSelect={true}
        />
      )}

      {/* Tag Picker bottom sheet (timestamp tag — single select) */}
      {showTsTagPicker && (
        <TagPicker
          selectedTagIds={editTsTagId ? [editTsTagId] : []}
          onChange={
            tsCreationStep === 'pick-tag'
              ? handleNewTimestampTagSelected
              : handleEditTsTagSelected
          }
          onClose={() => {
            setShowTsTagPicker(false)
            if (tsCreationStep === 'pick-tag') {
              setTsCreationStep('idle')
            }
          }}
          allowCreate={can('create_tags')}
          multiSelect={false}
        />
      )}

      {/* Edit timestamp bottom sheet */}
      {editingTimestamp && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setEditingTimestamp(null)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white shadow-xl lg:inset-0 lg:m-auto lg:h-fit lg:max-w-md lg:rounded-2xl">
            <div className="flex justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-gray-300 lg:hidden" />
            </div>
            <div className="px-4 pb-2">
              <h3 className="text-lg font-semibold text-gray-900">Edit Timestamp</h3>
            </div>
            <div className="space-y-3 px-4 pb-6">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    Start (seconds)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={editTsStart}
                    onChange={(e) => setEditTsStart(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    End (seconds)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={editTsEnd}
                    onChange={(e) => setEditTsEnd(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Tag
                </label>
                <button
                  onClick={() => setShowTsTagPicker(true)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {editingTimestamp.tag_name || 'Select tag…'}
                </button>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setEditingTimestamp(null)}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEditTimestamp}
                  className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">Delete this video?</h3>
              <p className="mt-2 text-sm text-gray-500">
                This will permanently remove the video file and all its tags.
              </p>
              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
