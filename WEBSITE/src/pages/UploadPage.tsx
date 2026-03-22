import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { generateThumbnail } from '../lib/ffmpeg'
import { formatFileSize, formatDuration } from '../lib/format'
import TagPicker from '../components/TagPicker'
import type { Tag } from '../types'

// Videos from iOS camera roll often have file.type === '' — check extension too
function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'hevc', '3gp'].includes(ext)
}

/**
 * Best-effort recorded date extraction from a File object alone.
 *
 * Priority:
 *   1. Android filename date  e.g. VID_20250315_143022.mp4
 *   2. file.lastModified      — on iOS this is typically the recording date
 *   3. null                   — user fills in manually
 */
function extractRecordedDateFromFile(file: File): string | null {
  const nameMatch = file.name.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/)
  if (nameMatch) {
    const [, y, m, d] = nameMatch
    const parsed = new Date(`${y}-${m}-${d}`)
    const now = Date.now()
    const tenYearsAgo = now - 10 * 365.25 * 24 * 60 * 60 * 1000
    if (!isNaN(parsed.getTime()) && parsed.getTime() > tenYearsAgo && parsed.getTime() <= now) {
      return `${y}-${m}-${d}`
    }
  }

  if (file.lastModified) {
    const modified = new Date(file.lastModified)
    const now = Date.now()
    const tenYearsAgo = now - 10 * 365.25 * 24 * 60 * 60 * 1000
    if (!isNaN(modified.getTime()) && modified.getTime() > tenYearsAgo && modified.getTime() <= now) {
      return modified.toISOString().split('T')[0]
    }
  }

  return null
}

function determineMediaType(file: File): string {
  if (isVideoFile(file)) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'other'
}

// ─── Bulk queue item ────────────────────────────────────────────────────────

type QueueItemStatus = 'pending' | 'generating' | 'ready' | 'duplicate' | 'uploading' | 'done' | 'error'

interface QueueItem {
  id: string
  file: File
  title: string
  recordedDate: string
  thumbnailBlob: Blob | null
  thumbnailPreview: string | null
  duration: number | null
  resolution: string | null
  status: QueueItemStatus
  progress: number
  error: string | null
  mediaId: string | null
}

// ─── Component ──────────────────────────────────────────────────────────────

type UploadMode = 'select' | 'single-form' | 'single-uploading' | 'bulk-queue' | 'bulk-uploading' | 'bulk-done'

export default function UploadPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = usePermissions()

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Shared state ───────────────────────────────────────────────────────
  const [mode, setMode] = useState<UploadMode>('select')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Single-file state (existing flow) ──────────────────────────────────
  const [file, setFile] = useState<File | null>(null)
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [generatingThumb, setGeneratingThumb] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [resolution, setResolution] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [recordedDate, setRecordedDate] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // ─── Bulk state ─────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([])
  const [bulkTags, setBulkTags] = useState<Tag[]>([])
  const [showBulkTagPicker, setShowBulkTagPicker] = useState(false)

  // Warn before navigating away during upload
  useEffect(() => {
    if (mode !== 'single-uploading' && mode !== 'bulk-uploading') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [mode])

  // Fetch tag details for single-file flow
  useEffect(() => {
    if (selectedTagIds.length === 0) { setSelectedTags([]); return }
    supabase.from('tags').select('*').in('id', selectedTagIds)
      .then(({ data }) => { if (data) setSelectedTags(data) })
  }, [selectedTagIds])

  // Fetch tag details for bulk flow
  useEffect(() => {
    if (bulkTagIds.length === 0) { setBulkTags([]); return }
    supabase.from('tags').select('*').in('id', bulkTagIds)
      .then(({ data }) => { if (data) setBulkTags(data) })
  }, [bulkTagIds])

  // ─── File selection handlers ────────────────────────────────────────────

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    if (files.length === 1) {
      handleSingleFileSelected(files[0])
    } else {
      handleBulkFilesSelected(files)
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    if (files.length === 1) {
      handleSingleFileSelected(files[0])
    } else {
      handleBulkFilesSelected(files)
    }
    e.target.value = ''
  }

  // ─── Single-file flow ──────────────────────────────────────────────────

  async function handleSingleFileSelected(selectedFile: File) {
    setFile(selectedFile)
    setMode('single-form')
    setError(null)
    setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    const guessedDate = extractRecordedDateFromFile(selectedFile)
    if (guessedDate) setRecordedDate(guessedDate)

    if (isVideoFile(selectedFile)) {
      setGeneratingThumb(true)
      try {
        const result = await generateThumbnail(selectedFile)
        setThumbnailBlob(result.blob)
        setThumbnailPreview(result.dataUrl)
        if (result.duration != null) setDuration(result.duration)
        if (result.width && result.height) setResolution(`${result.width}x${result.height}`)
      } catch {
        // Thumbnail failed — proceed without it
      }
      setGeneratingThumb(false)
    } else if (selectedFile.type.startsWith('image/')) {
      setThumbnailPreview(URL.createObjectURL(selectedFile))
    }
  }

  async function handleSingleUpload() {
    if (!file || !title.trim() || !user) return

    setMode('single-uploading')
    setUploadProgress(0)
    setError(null)

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const mediaType = determineMediaType(file)

      // 1. Get presigned upload URLs
      const urlRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-upload-url`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            type: mediaType,
          }),
        }
      )

      if (!urlRes.ok) throw new Error(`Failed to get upload URL: ${await urlRes.text()}`)

      const { media_upload_url, media_storage_path, thumbnail_upload_url, thumbnail_storage_path } = await urlRes.json()

      // 2. Upload file to R2
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', media_upload_url)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed with status ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.send(file)
      })

      // 3. Upload thumbnail
      let finalThumbnailPath: string | null = null
      if (thumbnailBlob && thumbnail_upload_url) {
        const thumbRes = await fetch(thumbnail_upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/webp' },
          body: thumbnailBlob,
        })
        if (thumbRes.ok) finalThumbnailPath = thumbnail_storage_path
      }

      // 4. Create media record
      const createRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            media_type: mediaType,
            storage_path: media_storage_path,
            thumbnail_path: finalThumbnailPath,
            duration: duration != null ? Math.round(duration) : null,
            recorded_at: recordedDate ? new Date(recordedDate).toISOString() : null,
            tag_ids: selectedTagIds,
            original_filename: file.name,
            file_size_bytes: file.size,
            mime_type: file.type || null,
            resolution,
          }),
        }
      )

      if (!createRes.ok) throw new Error(`Failed to create media: ${await createRes.text()}`)

      const { media_id } = await createRes.json()
      navigate(`/video/${media_id}`)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setMode('single-form')
    }
  }

  function resetAll() {
    setFile(null)
    setThumbnailBlob(null)
    setThumbnailPreview(null)
    setDuration(null)
    setResolution(null)
    setTitle('')
    setDescription('')
    setRecordedDate('')
    setSelectedTagIds([])
    setSelectedTags([])
    setUploadProgress(0)
    setQueue([])
    setBulkTagIds([])
    setBulkTags([])
    setError(null)
    setMode('select')
  }

  // ─── Bulk flow ─────────────────────────────────────────────────────────

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item))
  }, [])

  async function handleBulkFilesSelected(files: File[]) {
    setMode('bulk-queue')
    setError(null)

    // Build initial queue items
    const items: QueueItem[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      title: f.name.replace(/\.[^/.]+$/, ''),
      recordedDate: extractRecordedDateFromFile(f) ?? '',
      thumbnailBlob: null,
      thumbnailPreview: null,
      duration: null,
      resolution: null,
      status: 'pending' as const,
      progress: 0,
      error: null,
      mediaId: null,
    }))

    setQueue(items)

    // Check for duplicates
    const filenames = items.map(i => i.file.name)
    try {
      const { data: existing } = await supabase
        .from('media')
        .select('original_filename')
        .in('original_filename', filenames)

      if (existing && existing.length > 0) {
        const dupeNames = new Set(existing.map(e => e.original_filename))
        setQueue(prev => prev.map(item =>
          dupeNames.has(item.file.name)
            ? { ...item, status: 'duplicate' as const }
            : item
        ))
      }
    } catch {
      // Duplicate check failed — continue without flagging
    }

    // Generate thumbnails sequentially
    for (const item of items) {
      // Re-read status in case it was set to duplicate
      setQueue(prev => {
        const current = prev.find(i => i.id === item.id)
        if (!current || current.status === 'duplicate') return prev
        return prev.map(i => i.id === item.id ? { ...i, status: 'generating' as const } : i)
      })

      if (isVideoFile(item.file)) {
        try {
          const result = await generateThumbnail(item.file)
          setQueue(prev => prev.map(i => i.id === item.id ? {
            ...i,
            thumbnailBlob: result.blob,
            thumbnailPreview: result.dataUrl,
            duration: result.duration,
            resolution: result.width && result.height ? `${result.width}x${result.height}` : null,
            status: i.status === 'duplicate' ? 'duplicate' as const : 'ready' as const,
          } : i))
        } catch {
          setQueue(prev => prev.map(i => i.id === item.id ? {
            ...i,
            status: i.status === 'duplicate' ? 'duplicate' as const : 'ready' as const,
          } : i))
        }
      } else if (item.file.type.startsWith('image/')) {
        setQueue(prev => prev.map(i => i.id === item.id ? {
          ...i,
          thumbnailPreview: URL.createObjectURL(item.file),
          status: i.status === 'duplicate' ? 'duplicate' as const : 'ready' as const,
        } : i))
      } else {
        setQueue(prev => prev.map(i => i.id === item.id ? {
          ...i,
          status: i.status === 'duplicate' ? 'duplicate' as const : 'ready' as const,
        } : i))
      }
    }
  }

  function toggleDuplicate(id: string) {
    setQueue(prev => prev.map(item => {
      if (item.id !== id) return item
      if (item.status === 'duplicate') return { ...item, status: 'ready' as const }
      if (item.status === 'ready') return { ...item, status: 'duplicate' as const }
      return item
    }))
  }

  function removeFromQueue(id: string) {
    setQueue(prev => prev.filter(item => item.id !== id))
  }

  async function uploadSingleItem(item: QueueItem, token: string): Promise<void> {
    updateQueueItem(item.id, { status: 'uploading', progress: 0 })

    try {
      const mediaType = determineMediaType(item.file)

      // 1. Get presigned URLs
      const urlRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-upload-url`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: item.file.name,
            content_type: item.file.type || 'application/octet-stream',
            type: mediaType,
          }),
        }
      )

      if (!urlRes.ok) throw new Error(`Failed to get upload URL: ${await urlRes.text()}`)

      const { media_upload_url, media_storage_path, thumbnail_upload_url, thumbnail_storage_path } = await urlRes.json()

      // 2. Upload file to R2
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', media_upload_url)
        xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream')
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateQueueItem(item.id, { progress: Math.round((e.loaded / e.total) * 100) })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed with status ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.send(item.file)
      })

      // 3. Upload thumbnail
      let finalThumbnailPath: string | null = null
      if (item.thumbnailBlob && thumbnail_upload_url) {
        const thumbRes = await fetch(thumbnail_upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/webp' },
          body: item.thumbnailBlob,
        })
        if (thumbRes.ok) finalThumbnailPath = thumbnail_storage_path
      }

      // 4. Create media record
      const createRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: item.title,
            media_type: mediaType,
            storage_path: media_storage_path,
            thumbnail_path: finalThumbnailPath,
            duration: item.duration != null ? Math.round(item.duration) : null,
            recorded_at: item.recordedDate ? new Date(item.recordedDate).toISOString() : null,
            tag_ids: bulkTagIds,
            original_filename: item.file.name,
            file_size_bytes: item.file.size,
            mime_type: item.file.type || null,
            resolution: item.resolution,
          }),
        }
      )

      if (!createRes.ok) throw new Error(`Failed to create media: ${await createRes.text()}`)

      const { media_id } = await createRes.json()
      updateQueueItem(item.id, { status: 'done', progress: 100, mediaId: media_id })
    } catch (err) {
      updateQueueItem(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  async function handleBulkUpload() {
    if (!user) return

    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) { setError('Not authenticated'); return }

    setMode('bulk-uploading')

    const toUpload = queue.filter(item => item.status === 'ready')
    await Promise.all(toUpload.map(item => uploadSingleItem(item, token)))

    setMode('bulk-done')
  }

  async function retryFailed() {
    if (!user) return

    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) { setError('Not authenticated'); return }

    setMode('bulk-uploading')

    const toRetry = queue.filter(item => item.status === 'error')
    await Promise.all(toRetry.map(item => uploadSingleItem(item, token)))

    setMode('bulk-done')
  }

  // ─── Derived values ────────────────────────────────────────────────────

  const readyCount = queue.filter(i => i.status === 'ready').length
  const doneCount = queue.filter(i => i.status === 'done').length
  const errorCount = queue.filter(i => i.status === 'error').length
  const duplicateCount = queue.filter(i => i.status === 'duplicate').length
  const isGenerating = queue.some(i => i.status === 'generating' || i.status === 'pending')

  // ─── Render: file selection ────────────────────────────────────────────

  if (mode === 'select') {
    return (
      <div className="px-4 py-6">
        <label
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-20 transition-colors ${
            isDragging
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400'
          }`}
        >
          <div className="mb-3 text-4xl text-gray-300">&#8593;</div>
          <p className="text-sm font-medium text-gray-600">Tap to select files</p>
          <p className="text-sm text-gray-400">or drag and drop</p>
          <p className="mt-2 text-xs text-gray-400">Video, image, or other media &middot; Select multiple for bulk upload</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
            accept="video/*,image/*,audio/*"
          />
        </label>
      </div>
    )
  }

  // ─── Render: single-file form (existing flow) ─────────────────────────

  if (mode === 'single-form' || mode === 'single-uploading') {
    return (
      <div className="px-4 py-4">
        {/* File preview row */}
        {file && (
          <div className="mb-4 flex items-start gap-3">
            <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-gray-200">
              {thumbnailPreview ? (
                <img src={thumbnailPreview} alt="Thumbnail" className="h-full w-full object-cover" />
              ) : generatingThumb ? (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                  No preview
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">
                {formatFileSize(file.size)}
                {duration != null && ` \u00b7 ${formatDuration(duration)}`}
              </p>
              {generatingThumb && (
                <p className="text-xs text-blue-500">Generating thumbnail&hellip;</p>
              )}
            </div>
            {mode === 'single-form' && (
              <button onClick={resetAll} className="shrink-0 text-gray-400">&times;</button>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        {mode === 'single-uploading' && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>Uploading&hellip;</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={mode === 'single-uploading'}
              placeholder="Video title"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={mode === 'single-uploading'}
              placeholder="Optional description"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Recorded Date</label>
            <input
              type="date"
              value={recordedDate}
              onChange={(e) => setRecordedDate(e.target.value)}
              disabled={mode === 'single-uploading'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-2.5 pr-1.5 text-xs text-gray-600"
                >
                  {tag.name}
                  <button
                    onClick={() => setSelectedTagIds((prev) => prev.filter((id) => id !== tag.id))}
                    disabled={mode === 'single-uploading'}
                    className="ml-0.5 text-gray-400 hover:text-gray-600"
                  >
                    &times;
                  </button>
                </span>
              ))}
              <button
                onClick={() => setShowTagPicker(true)}
                disabled={mode === 'single-uploading'}
                className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-400 disabled:opacity-50"
              >
                + Add Tag
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSingleUpload}
            disabled={mode === 'single-uploading' || !title.trim() || !file || generatingThumb}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {mode === 'single-uploading' ? 'Uploading\u2026' : 'Upload'}
          </button>
        </div>

        {showTagPicker && (
          <TagPicker
            selectedTagIds={selectedTagIds}
            onChange={setSelectedTagIds}
            onClose={() => setShowTagPicker(false)}
            allowCreate={can('create_tags')}
          />
        )}
      </div>
    )
  }

  // ─── Render: bulk queue / uploading / done ─────────────────────────────

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          {mode === 'bulk-done' ? 'Upload Complete' : `${queue.length} files selected`}
        </h2>
        {mode === 'bulk-queue' && (
          <button onClick={resetAll} className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Summary bar for done state */}
      {mode === 'bulk-done' && (
        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
          <span className="text-green-600">{doneCount} uploaded</span>
          {errorCount > 0 && <span className="text-red-500"> &middot; {errorCount} failed</span>}
          {duplicateCount > 0 && <span className="text-gray-400"> &middot; {duplicateCount} skipped</span>}
        </div>
      )}

      {/* Progress summary during upload */}
      {mode === 'bulk-uploading' && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-700">
          Uploading&hellip; {doneCount} of {queue.filter(i => i.status === 'uploading' || i.status === 'done' || i.status === 'error').length} complete
        </div>
      )}

      {/* Queue list */}
      <div className="space-y-2">
        {queue.map(item => (
          <div
            key={item.id}
            className={`flex items-center gap-3 rounded-lg border p-2.5 ${
              item.status === 'duplicate' ? 'border-gray-200 bg-gray-50 opacity-50' :
              item.status === 'done' ? 'border-green-200 bg-green-50' :
              item.status === 'error' ? 'border-red-200 bg-red-50' :
              'border-gray-200'
            }`}
          >
            {/* Thumbnail */}
            <div className="h-12 w-18 shrink-0 overflow-hidden rounded bg-gray-200">
              {item.thumbnailPreview ? (
                <img src={item.thumbnailPreview} alt="" className="h-full w-full object-cover" />
              ) : item.status === 'generating' || item.status === 'pending' ? (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                  &mdash;
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500">
                {formatFileSize(item.file.size)}
                {item.duration != null && ` \u00b7 ${formatDuration(item.duration)}`}
                {item.recordedDate && ` \u00b7 ${item.recordedDate}`}
              </p>

              {/* Per-item progress bar */}
              {item.status === 'uploading' && (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}

              {item.status === 'error' && item.error && (
                <p className="mt-0.5 text-xs text-red-500">{item.error}</p>
              )}
            </div>

            {/* Status / actions */}
            <div className="shrink-0">
              {item.status === 'duplicate' && mode === 'bulk-queue' && (
                <button
                  onClick={() => toggleDuplicate(item.id)}
                  className="rounded-md bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300"
                >
                  Include
                </button>
              )}
              {item.status === 'ready' && mode === 'bulk-queue' && (
                <button
                  onClick={() => removeFromQueue(item.id)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              )}
              {item.status === 'done' && (
                <span className="text-xs text-green-600">&#10003;</span>
              )}
              {item.status === 'uploading' && (
                <span className="text-xs text-blue-500">{item.progress}%</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Shared tags (queue and uploading modes) */}
      {(mode === 'bulk-queue' || mode === 'bulk-uploading') && (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">Tags (applied to all)</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {bulkTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-2.5 pr-1.5 text-xs text-gray-600"
              >
                {tag.name}
                <button
                  onClick={() => setBulkTagIds((prev) => prev.filter((id) => id !== tag.id))}
                  disabled={mode === 'bulk-uploading'}
                  className="ml-0.5 text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </span>
            ))}
            <button
              onClick={() => setShowBulkTagPicker(true)}
              disabled={mode === 'bulk-uploading'}
              className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-400 disabled:opacity-50"
            >
              + Add Tag
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-6 space-y-2">
        {mode === 'bulk-queue' && (
          <button
            onClick={handleBulkUpload}
            disabled={readyCount === 0 || isGenerating}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {isGenerating
              ? 'Preparing\u2026'
              : `Upload ${readyCount} video${readyCount !== 1 ? 's' : ''}`}
          </button>
        )}

        {mode === 'bulk-done' && errorCount > 0 && (
          <button
            onClick={retryFailed}
            className="w-full rounded-lg bg-red-600 py-3 text-sm font-medium text-white"
          >
            Retry {errorCount} failed
          </button>
        )}

        {mode === 'bulk-done' && (
          <button
            onClick={resetAll}
            className="w-full rounded-lg border border-gray-200 py-3 text-sm font-medium text-gray-700"
          >
            Upload more
          </button>
        )}
      </div>

      {showBulkTagPicker && (
        <TagPicker
          selectedTagIds={bulkTagIds}
          onChange={setBulkTagIds}
          onClose={() => setShowBulkTagPicker(false)}
          allowCreate={can('create_tags')}
        />
      )}
    </div>
  )
}
