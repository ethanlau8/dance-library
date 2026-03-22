import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { generateThumbnail } from '../lib/ffmpeg'
import { formatFileSize, formatDuration } from '../lib/format'
import TagPicker from '../components/TagPicker'
import type { Tag } from '../types'

type UploadState = 'select' | 'form' | 'uploading'

// Videos from iOS camera roll often have file.type === '' — check extension too
function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'hevc', '3gp'].includes(ext)
}

export default function UploadPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = usePermissions()

  const fileInputRef = useRef<HTMLInputElement>(null)

  // File state
  const [file, setFile] = useState<File | null>(null)
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [generatingThumb, setGeneratingThumb] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [recordedDate, setRecordedDate] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)

  // Upload state
  const [uploadState, setUploadState] = useState<UploadState>('select')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Drag state
  const [isDragging, setIsDragging] = useState(false)

  // Warn before navigating away during upload
  useEffect(() => {
    if (uploadState !== 'uploading') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [uploadState])

  async function handleFileSelected(selectedFile: File) {
    setFile(selectedFile)
    setUploadState('form')
    setError(null)
    setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    if (isVideoFile(selectedFile)) {
      setGeneratingThumb(true)
      try {
        const { blob, dataUrl, duration: dur } = await generateThumbnail(selectedFile)
        setThumbnailBlob(blob)
        setThumbnailPreview(dataUrl)
        if (dur != null) setDuration(dur)
      } catch {
        // Thumbnail failed — proceed without it, user can still upload
      }
      setGeneratingThumb(false)
    } else if (selectedFile.type.startsWith('image/')) {
      setThumbnailPreview(URL.createObjectURL(selectedFile))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) handleFileSelected(dropped)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) handleFileSelected(selected)
    // Reset input so selecting the same file again triggers onChange
    e.target.value = ''
  }

  // Fetch tag details when selection changes
  useEffect(() => {
    if (selectedTagIds.length === 0) {
      setSelectedTags([])
      return
    }
    supabase
      .from('tags')
      .select('*')
      .in('id', selectedTagIds)
      .then(({ data }) => { if (data) setSelectedTags(data) })
  }, [selectedTagIds])

  function determineMediaType(file: File): string {
    if (isVideoFile(file)) return 'video'
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('audio/')) return 'audio'
    return 'other'
  }

  async function handleUpload() {
    if (!file || !title.trim() || !user) return

    setUploadState('uploading')
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

      if (!urlRes.ok) {
        throw new Error(`Failed to get upload URL: ${await urlRes.text()}`)
      }

      const {
        media_upload_url,
        media_storage_path,
        thumbnail_upload_url,
        thumbnail_storage_path,
      } = await urlRes.json()

      // 2. Upload file to R2 with XHR for progress tracking
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

      // 3. Upload thumbnail if we have one
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
          }),
        }
      )

      if (!createRes.ok) {
        throw new Error(`Failed to create media: ${await createRes.text()}`)
      }

      const { media_id } = await createRes.json()
      navigate(`/video/${media_id}`)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploadState('form')
    }
  }

  function resetForm() {
    setFile(null)
    setThumbnailBlob(null)
    setThumbnailPreview(null)
    setDuration(null)
    setTitle('')
    setDescription('')
    setRecordedDate('')
    setSelectedTagIds([])
    setSelectedTags([])
    setUploadState('select')
    setUploadProgress(0)
    setError(null)
  }

  // --- Render ---

  // Step 1: File selection / drop zone
  // Use <label> wrapping the hidden input — reliable on iOS/Android unlike div+onClick+.click()
  if (uploadState === 'select') {
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
          <div className="mb-3 text-4xl text-gray-300">↑</div>
          <p className="text-sm font-medium text-gray-600">Tap to select file</p>
          <p className="text-sm text-gray-400">or drag and drop</p>
          <p className="mt-2 text-xs text-gray-400">Video, image, or other media</p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileInput}
            accept="video/*,image/*,audio/*"
          />
        </label>
      </div>
    )
  }

  // Step 2: Form + upload
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
              {duration != null && ` · ${formatDuration(duration)}`}
            </p>
            {generatingThumb && (
              <p className="text-xs text-blue-500">Generating thumbnail…</p>
            )}
          </div>
          {uploadState === 'form' && (
            <button onClick={resetForm} className="shrink-0 text-gray-400">×</button>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Upload progress */}
      {uploadState === 'uploading' && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>Uploading…</span>
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

      {/* Metadata form */}
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={uploadState === 'uploading'}
            placeholder="Video title"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={uploadState === 'uploading'}
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
            disabled={uploadState === 'uploading'}
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
                  disabled={uploadState === 'uploading'}
                  className="ml-0.5 text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              onClick={() => setShowTagPicker(true)}
              disabled={uploadState === 'uploading'}
              className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-400 disabled:opacity-50"
            >
              + Add Tag
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={handleUpload}
          disabled={uploadState === 'uploading' || !title.trim() || !file || generatingThumb}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploadState === 'uploading' ? 'Uploading…' : 'Upload'}
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
