import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { generateThumbnail, extractVideoMetadata } from '../lib/ffmpeg'
import { runWithConcurrency } from '../lib/concurrency'
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

function isMobileDevice(): boolean {
  return window.innerWidth < 768 ||
    ('ontouchstart' in window && window.innerWidth < 1024)
}

// ─── Upload pipeline step tracking ─────────────────────────────────────────

type UploadStepName = 'presign' | 'upload' | 'thumbnail-gen' | 'thumbnail-up' | 'db-save'
type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

interface UploadStep {
  name: UploadStepName
  label: string
  status: StepStatus
  progress?: number
  error?: string
}

const UPLOAD_STEP_DEFS: { name: UploadStepName; label: string }[] = [
  { name: 'presign', label: 'Preparing upload' },
  { name: 'upload', label: 'Uploading file' },
  { name: 'thumbnail-gen', label: 'Generating thumbnail' },
  { name: 'thumbnail-up', label: 'Uploading thumbnail' },
  { name: 'db-save', label: 'Saving to library' },
]

function createInitialSteps(): UploadStep[] {
  return UPLOAD_STEP_DEFS.map(s => ({ name: s.name, label: s.label, status: 'pending' as const }))
}

// ─── Step checklist UI ──────────────────────────────────────────────────────

function StepChecklist({ steps }: { steps: UploadStep[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.name} className="flex items-center gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center">
            {step.status === 'done' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs text-green-600">
                &#10003;
              </span>
            )}
            {step.status === 'active' && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
            )}
            {step.status === 'pending' && (
              <span className="h-2 w-2 rounded-full bg-gray-300" />
            )}
            {step.status === 'error' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs text-red-600">
                !
              </span>
            )}
            {step.status === 'skipped' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100 text-xs text-yellow-600">
                &ndash;
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className={`text-sm ${
              step.status === 'active' ? 'font-medium text-gray-900' :
              step.status === 'done' ? 'text-gray-500' :
              step.status === 'error' ? 'text-red-600' :
              step.status === 'skipped' ? 'text-yellow-600' :
              'text-gray-400'
            }`}>
              {step.label}
              {step.status === 'active' && step.name === 'upload' && step.progress != null && (
                <span className="ml-2 text-blue-600">{step.progress}%</span>
              )}
            </p>
            {step.status === 'error' && step.error && (
              <p className="text-xs text-red-500">{step.error}</p>
            )}
            {step.status === 'active' && step.name === 'upload' && step.progress != null && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${step.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Bulk queue item ────────────────────────────────────────────────────────

type QueueItemStatus = 'pending' | 'ready' | 'duplicate' | 'uploading' | 'done' | 'error'

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
  steps: UploadStep[]
  currentStep: UploadStepName | null
}

// ─── Component ──────────────────────────────────────────────────────────────

type UploadMode = 'select' | 'single-form' | 'single-uploading' | 'single-done' | 'bulk-queue' | 'bulk-uploading' | 'bulk-done'

export default function UploadPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { can } = usePermissions()

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Shared state ───────────────────────────────────────────────────────
  const [mode, setMode] = useState<UploadMode>('select')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Single-file state ──────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null)
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
  const [singleSteps, setSingleSteps] = useState<UploadStep[]>([])
  const [completedMediaId, setCompletedMediaId] = useState<string | null>(null)
  const [thumbnailWarning, setThumbnailWarning] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  // ─── Upload options ─────────────────────────────────────────────────────
  const [skipThumbnails, setSkipThumbnails] = useState(false)

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

  // ─── Helpers ────────────────────────────────────────────────────────────

  function updateSingleStep(stepName: UploadStepName, updates: Partial<UploadStep>) {
    setSingleSteps(prev => prev.map(s => s.name === stepName ? { ...s, ...updates } : s))
  }

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
    if (files.length === 0) {
      // User cancelled the file picker
      setMode('select')
      return
    }
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
    setDuplicateWarning(null)
    setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    // Check if file already exists in DB
    try {
      const { data: existing } = await supabase
        .from('media')
        .select('original_filename')
        .eq('original_filename', selectedFile.name)
        .limit(1)

      if (existing && existing.length > 0) {
        setDuplicateWarning(`A file named "${selectedFile.name}" already exists in the library. You can still upload if this is intentional.`)
      }
    } catch {
      // Duplicate check failed — continue without flagging
    }

    const guessedDate = extractRecordedDateFromFile(selectedFile)
    if (guessedDate) setRecordedDate(guessedDate)

    if (isVideoFile(selectedFile)) {
      // Fast metadata extraction (~instant, header-only)
      const meta = await extractVideoMetadata(selectedFile)
      if (meta.duration != null) setDuration(meta.duration)
      if (meta.width && meta.height) setResolution(`${meta.width}x${meta.height}`)

      // Background thumbnail generation for PREVIEW ONLY (not relied upon for upload)
      setGeneratingThumb(true)
      generateThumbnail(selectedFile)
        .then(result => {
          setThumbnailPreview(result.dataUrl)
        })
        .catch(() => { /* Preview failed — no problem, upload pipeline handles it */ })
        .finally(() => setGeneratingThumb(false))
    } else if (selectedFile.type.startsWith('image/')) {
      setThumbnailPreview(URL.createObjectURL(selectedFile))
    }
  }

  async function handleSingleUpload() {
    if (!file || !title.trim() || !user) return

    setMode('single-uploading')
    setError(null)
    setThumbnailWarning(null)
    setSingleSteps(createInitialSteps())

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const mediaType = determineMediaType(file)

      // ── Step 1: Get presigned upload URLs ──
      updateSingleStep('presign', { status: 'active' })

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

      updateSingleStep('presign', { status: 'done' })

      // ── Step 2: Upload file to R2 ──
      updateSingleStep('upload', { status: 'active', progress: 0 })

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        // Register upload listener BEFORE open() — some browsers
        // suppress cross-origin progress events if attached after open()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            updateSingleStep('upload', { progress: pct })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed with status ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('PUT', media_upload_url)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.send(file)
      })

      updateSingleStep('upload', { status: 'done', progress: 100 })

      // ── Step 3: Generate thumbnail (sequential, blocking) ──
      let finalThumbnailBlob: Blob | null = null

      if (skipThumbnails) {
        updateSingleStep('thumbnail-gen', { status: 'skipped', error: 'Skipped by user' })
      } else if (isVideoFile(file)) {
        updateSingleStep('thumbnail-gen', { status: 'active' })
        try {
          const thumbResult = await generateThumbnail(file)
          finalThumbnailBlob = thumbResult.blob
          setThumbnailPreview(thumbResult.dataUrl)
          updateSingleStep('thumbnail-gen', { status: 'done' })
        } catch (thumbErr) {
          console.warn('Thumbnail generation failed:', thumbErr)
          updateSingleStep('thumbnail-gen', { status: 'skipped', error: 'Could not generate thumbnail' })
          setThumbnailWarning('Thumbnail generation failed — video was uploaded without a thumbnail')
        }
      } else {
        updateSingleStep('thumbnail-gen', { status: 'skipped' })
      }

      // ── Step 4: Upload thumbnail to R2 ──
      let finalThumbnailPath: string | null = null

      if (skipThumbnails) {
        updateSingleStep('thumbnail-up', { status: 'skipped', error: 'Skipped by user' })
      } else if (finalThumbnailBlob && thumbnail_upload_url) {
        updateSingleStep('thumbnail-up', { status: 'active' })
        try {
          const thumbRes = await fetch(thumbnail_upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/webp' },
            body: finalThumbnailBlob,
          })
          if (thumbRes.ok) {
            finalThumbnailPath = thumbnail_storage_path
            updateSingleStep('thumbnail-up', { status: 'done' })
          } else {
            throw new Error(`Thumbnail upload returned ${thumbRes.status}`)
          }
        } catch (thumbUpErr) {
          console.warn('Thumbnail upload failed:', thumbUpErr)
          updateSingleStep('thumbnail-up', { status: 'skipped', error: 'Thumbnail upload failed' })
          setThumbnailWarning('Thumbnail could not be uploaded — video saved without thumbnail')
        }
      } else {
        updateSingleStep('thumbnail-up', { status: 'skipped' })
      }

      // ── Step 5: Create media record ──
      updateSingleStep('db-save', { status: 'active' })

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
      updateSingleStep('db-save', { status: 'done' })

      setCompletedMediaId(media_id)
      setMode('single-done')
    } catch (err) {
      console.error('Upload error:', err)
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)

      // Mark the currently active step as errored
      setSingleSteps(prev => prev.map(s =>
        s.status === 'active' ? { ...s, status: 'error' as const, error: message } : s
      ))
    }
  }

  function resetAll() {
    setFile(null)
    setThumbnailPreview(null)
    setDuration(null)
    setResolution(null)
    setTitle('')
    setDescription('')
    setRecordedDate('')
    setSelectedTagIds([])
    setSelectedTags([])
    setSingleSteps([])
    setCompletedMediaId(null)
    setThumbnailWarning(null)
    setDuplicateWarning(null)
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

  function updateQueueItemStep(id: string, stepName: UploadStepName, updates: Partial<UploadStep>) {
    setQueue(prev => prev.map(qi => {
      if (qi.id !== id) return qi
      return {
        ...qi,
        currentStep: updates.status === 'active' ? stepName : qi.currentStep,
        steps: qi.steps.map(s => s.name === stepName ? { ...s, ...updates } : s),
      }
    }))
  }

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
      steps: [],
      currentStep: null,
    }))

    setQueue(items)

    // Check for duplicates
    const filenames = items.map(i => i.file.name)
    let dupeNames = new Set<string>()
    try {
      const { data: existing } = await supabase
        .from('media')
        .select('original_filename')
        .in('original_filename', filenames)

      if (existing && existing.length > 0) {
        dupeNames = new Set(existing.map(e => e.original_filename))
      }
    } catch {
      // Duplicate check failed — continue without flagging
    }

    // Fast metadata extraction for all files (header-only, no thumbnail generation)
    const updatedItems = await Promise.all(items.map(async (item) => {
      let duration: number | null = null
      let resolution: string | null = null

      if (isVideoFile(item.file)) {
        const meta = await extractVideoMetadata(item.file)
        duration = meta.duration
        resolution = meta.width && meta.height ? `${meta.width}x${meta.height}` : null
      }

      return {
        ...item,
        duration,
        resolution,
        thumbnailPreview: item.file.type.startsWith('image/') ? URL.createObjectURL(item.file) : null,
        status: dupeNames.has(item.file.name) ? 'duplicate' as const : 'ready' as const,
      }
    }))

    setQueue(updatedItems)
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
    const steps = createInitialSteps()
    updateQueueItem(item.id, { status: 'uploading', progress: 0, steps, currentStep: 'presign' })

    try {
      const mediaType = determineMediaType(item.file)

      // ── Step 1: Get presigned URLs ──
      updateQueueItemStep(item.id, 'presign', { status: 'active' })

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

      updateQueueItemStep(item.id, 'presign', { status: 'done' })

      // ── Step 2: Upload file to R2 ──
      updateQueueItemStep(item.id, 'upload', { status: 'active', progress: 0 })

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            updateQueueItemStep(item.id, 'upload', { progress: pct })
            updateQueueItem(item.id, { progress: pct })
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed with status ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('PUT', media_upload_url)
        xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream')
        xhr.send(item.file)
      })

      updateQueueItemStep(item.id, 'upload', { status: 'done', progress: 100 })

      // ── Step 3: Generate thumbnail (sequential, blocking) ──
      let thumbBlob: Blob | null = null

      if (skipThumbnails) {
        updateQueueItemStep(item.id, 'thumbnail-gen', { status: 'skipped', error: 'Skipped by user' })
      } else if (isVideoFile(item.file)) {
        updateQueueItemStep(item.id, 'thumbnail-gen', { status: 'active' })
        try {
          const thumbResult = await generateThumbnail(item.file)
          thumbBlob = thumbResult.blob
          updateQueueItem(item.id, { thumbnailPreview: thumbResult.dataUrl })
          updateQueueItemStep(item.id, 'thumbnail-gen', { status: 'done' })
        } catch {
          updateQueueItemStep(item.id, 'thumbnail-gen', { status: 'skipped', error: 'Thumbnail generation failed' })
        }
      } else {
        updateQueueItemStep(item.id, 'thumbnail-gen', { status: 'skipped' })
      }

      // ── Step 4: Upload thumbnail to R2 ──
      let finalThumbnailPath: string | null = null

      if (skipThumbnails) {
        updateQueueItemStep(item.id, 'thumbnail-up', { status: 'skipped', error: 'Skipped by user' })
      } else if (thumbBlob && thumbnail_upload_url) {
        updateQueueItemStep(item.id, 'thumbnail-up', { status: 'active' })
        try {
          const thumbRes = await fetch(thumbnail_upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/webp' },
            body: thumbBlob,
          })
          if (thumbRes.ok) {
            finalThumbnailPath = thumbnail_storage_path
            updateQueueItemStep(item.id, 'thumbnail-up', { status: 'done' })
          } else {
            throw new Error('Thumbnail upload failed')
          }
        } catch {
          updateQueueItemStep(item.id, 'thumbnail-up', { status: 'skipped', error: 'Thumbnail upload failed' })
        }
      } else {
        updateQueueItemStep(item.id, 'thumbnail-up', { status: 'skipped' })
      }

      // ── Step 5: Create media record (WITH thumbnail) ──
      updateQueueItemStep(item.id, 'db-save', { status: 'active' })

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
      updateQueueItemStep(item.id, 'db-save', { status: 'done' })
      updateQueueItem(item.id, { status: 'done', progress: 100, mediaId: media_id })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setQueue(prev => prev.map(qi => {
        if (qi.id !== item.id) return qi
        return {
          ...qi,
          status: 'error' as const,
          error: message,
          steps: qi.steps.map(s =>
            s.status === 'active' ? { ...s, status: 'error' as const, error: message } : s
          ),
        }
      }))
    }
  }

  async function handleBulkUpload() {
    if (!user) return

    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) { setError('Not authenticated'); return }

    setMode('bulk-uploading')

    const toUpload = queue.filter(item => item.status === 'ready')
    const concurrency = isMobileDevice() ? 1 : 2
    await runWithConcurrency(toUpload.map(item => () => uploadSingleItem(item, token)), concurrency)

    setMode('bulk-done')
  }

  async function retryFailed() {
    if (!user) return

    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) { setError('Not authenticated'); return }

    setMode('bulk-uploading')

    const toRetry = queue.filter(item => item.status === 'error')
    const concurrency = isMobileDevice() ? 1 : 2
    await runWithConcurrency(toRetry.map(item => () => uploadSingleItem(item, token)), concurrency)

    setMode('bulk-done')
  }

  // ─── Derived values ────────────────────────────────────────────────────

  const readyCount = queue.filter(i => i.status === 'ready').length
  const doneCount = queue.filter(i => i.status === 'done').length
  const errorCount = queue.filter(i => i.status === 'error').length
  const duplicateCount = queue.filter(i => i.status === 'duplicate').length
  const isGenerating = queue.some(i => i.status === 'pending')

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

  // ─── Render: single-file uploading (step-by-step progress) ──────────────

  if (mode === 'single-uploading') {
    return (
      <div className="px-4 py-6">
        {/* File info header */}
        {file && (
          <div className="mb-6 flex items-center gap-3">
            <div className="h-12 w-18 shrink-0 overflow-hidden rounded-lg bg-gray-200">
              {thumbnailPreview ? (
                <img src={thumbnailPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
            </div>
          </div>
        )}

        <StepChecklist steps={singleSteps} />

        {error && (
          <div className="mt-6">
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            <div className="flex gap-2">
              <button
                onClick={resetAll}
                className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSingleUpload}
                className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-medium text-white"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {thumbnailWarning && !error && (
          <div className="mt-4 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
            {thumbnailWarning}
          </div>
        )}

        {!error && (
          <p className="mt-6 text-center text-xs text-gray-400">Do not close this page</p>
        )}
      </div>
    )
  }

  // ─── Render: single-file upload complete ────────────────────────────────

  if (mode === 'single-done') {
    return (
      <div className="px-4 py-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <span className="text-xl text-green-600">&#10003;</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">Upload Complete</p>
        </div>

        <StepChecklist steps={singleSteps} />

        {thumbnailWarning && (
          <div className="mt-4 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
            {thumbnailWarning}
          </div>
        )}

        <div className="mt-6 space-y-2">
          {completedMediaId && (
            <button
              onClick={() => navigate(`/video/${completedMediaId}`)}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white"
            >
              View Video
            </button>
          )}
          <button
            onClick={resetAll}
            className="w-full rounded-lg border border-gray-200 py-3 text-sm font-medium text-gray-700"
          >
            Upload Another
          </button>
        </div>
      </div>
    )
  }

  // ─── Render: single-file form ─────────────────────────────────────────

  if (mode === 'single-form') {
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
            <button onClick={resetAll} className="shrink-0 text-gray-400">&times;</button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        {duplicateWarning && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{duplicateWarning}</div>
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
              placeholder="Video title"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Recorded Date</label>
            <input
              type="date"
              value={recordedDate}
              onChange={(e) => setRecordedDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
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
                    className="ml-0.5 text-gray-400 hover:text-gray-600"
                  >
                    &times;
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
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={skipThumbnails}
              onChange={(e) => setSkipThumbnails(e.target.checked)}
              className="rounded border-gray-300"
            />
            Skip thumbnail generation
          </label>
          <p className="mt-1 text-xs text-gray-400">Faster uploads. Generate thumbnails later with the batch tool.</p>
        </div>

        <div className="mt-4">
          <button
            onClick={handleSingleUpload}
            disabled={!title.trim() || !file}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Upload
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
      {mode === 'bulk-uploading' && (() => {
        const activeCount = queue.filter(i => ['uploading', 'done', 'error'].includes(i.status)).length
        const completedCount = doneCount + errorCount
        const overallProgress = activeCount > 0 ? Math.round((completedCount / activeCount) * 100) : 0
        return (
          <div className="mb-4">
            <div className="mb-2 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-700">
              Uploading&hellip; {completedCount} of {activeCount} complete
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-gray-400">Do not close this page</p>
          </div>
        )
      })()}

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

              {/* Per-item step indicator during upload */}
              {item.status === 'uploading' && item.currentStep && (
                <div className="mt-1">
                  <p className="text-xs text-blue-500">
                    {item.steps.find(s => s.status === 'active')?.label ?? 'Processing...'}
                    {item.currentStep === 'upload' && ` ${item.progress}%`}
                  </p>
                  {item.currentStep === 'upload' && (
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
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
              {item.status === 'done' && item.mediaId && mode === 'bulk-done' ? (
                <button
                  onClick={() => navigate(`/video/${item.mediaId}`)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  View
                </button>
              ) : item.status === 'done' && (
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

      {/* Skip thumbnail toggle */}
      {mode === 'bulk-queue' && (
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={skipThumbnails}
              onChange={(e) => setSkipThumbnails(e.target.checked)}
              className="rounded border-gray-300"
            />
            Skip thumbnail generation
          </label>
          <p className="mt-1 text-xs text-gray-400">Faster uploads. Generate thumbnails later with the batch tool.</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 space-y-2">
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
