// ─── Binary atom parser ─────────────────────────────────────────────────────
// Reads the first 512KB of a video file to extract creation date and duration
// from MP4/MOV container atoms. Covers iOS (com.apple.quicktime.creationdate),
// Android/cameras (©day), and any file with a valid mvhd atom.

function findSequence(
  bytes: Uint8Array,
  pattern: number[] | Uint8Array,
  startFrom = 0
): number {
  outer: for (let i = startFrom; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer
    }
    return i
  }
  return -1
}

function isValidDateString(text: string): boolean {
  if (!text || text.length < 10) return false
  const d = new Date(text)
  if (isNaN(d.getTime())) return false
  const year = d.getFullYear()
  return year >= 2000 && year <= 2035
}

interface MvhdFields {
  creationTimeSecs: number
  timescale: number
  duration: number
}

function parseMvhd(bytes: Uint8Array, view: DataView): MvhdFields | null {
  const idx = findSequence(bytes, [0x6d, 0x76, 0x68, 0x64]) // 'mvhd'
  if (idx === -1) return null

  let offset = idx + 4
  if (offset + 4 > bytes.length) return null
  const version = bytes[offset]
  offset += 4 // skip version(1) + flags(3)

  let creationTimeSecs: number
  let timescale: number
  let duration: number

  if (version === 0) {
    if (offset + 16 > bytes.length) return null
    creationTimeSecs = view.getUint32(offset, false); offset += 4
    offset += 4 // skip modification_time
    timescale = view.getUint32(offset, false); offset += 4
    duration = view.getUint32(offset, false)
  } else if (version === 1) {
    if (offset + 28 > bytes.length) return null
    const ctHi = view.getUint32(offset, false); offset += 4
    const ctLo = view.getUint32(offset, false); offset += 4
    creationTimeSecs = ctHi * 0x100000000 + ctLo
    offset += 8 // skip modification_time
    timescale = view.getUint32(offset, false); offset += 4
    const durHi = view.getUint32(offset, false)
    const durLo = view.getUint32(offset + 4, false)
    duration = durHi * 0x100000000 + durLo
  } else {
    return null
  }

  return { creationTimeSecs, timescale, duration }
}

// Priority 1: com.apple.quicktime.creationdate (iOS ground truth)
function findAppleCreationDate(bytes: Uint8Array): string | null {
  const key = new TextEncoder().encode('com.apple.quicktime.creationdate')
  const idx = findSequence(bytes, key)
  if (idx === -1) return null
  // The ISO date string appears in the ilst value atom shortly after the key.
  // Decode up to 4KB forward and regex-match it.
  const slice = bytes.subarray(idx, Math.min(idx + 4096, bytes.length))
  const text = new TextDecoder().decode(slice)
  const m = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+\-Z][^\x00-\x1f]{0,6})/)
    ?? text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  if (!m) return null
  return isValidDateString(m[1]) ? m[1] : null
}

// Priority 2: ©day atom — QuickTime user data (Android, GoPro, QuickTime)
function findCopyDayAtom(bytes: Uint8Array, view: DataView): string | null {
  const tag = [0xa9, 0x64, 0x61, 0x79] // ©day
  const idx = findSequence(bytes, tag)
  if (idx === -1) return null

  // Format A — QuickTime udta: [4B '©day'][2B str_len][2B language][UTF-8]
  if (idx + 8 < bytes.length) {
    const strLen = view.getUint16(idx + 4, false)
    if (strLen > 0 && strLen < 256 && idx + 8 + strLen <= bytes.length) {
      const text = new TextDecoder().decode(bytes.subarray(idx + 8, idx + 8 + strLen)).trim()
      if (isValidDateString(text)) return text
    }
  }

  // Format B — iTunes meta: look for 'data' sub-atom nearby
  const dataTag = [0x64, 0x61, 0x74, 0x61] // 'data'
  const dataIdx = findSequence(bytes, dataTag, idx + 4)
  if (dataIdx !== -1 && dataIdx < idx + 256) {
    // skip 'data'(4) + type_flag(4) + locale(4) = 12 bytes
    const valStart = dataIdx + 4 + 4 + 4
    const valEnd = Math.min(valStart + 256, bytes.length)
    const text = new TextDecoder()
      .decode(bytes.subarray(valStart, valEnd))
      .replace(/\x00.*/, '')
      .trim()
    if (isValidDateString(text)) return text
  }

  return null
}

// Priority 3: mvhd.creation_time (Mac HFS+ epoch, skip if 0 — iOS often sets this to 0)
function mvhdCreationDate(fields: MvhdFields): string | null {
  if (fields.creationTimeSecs === 0) return null
  // Mac HFS+ epoch: 1904-01-01T00:00:00Z = -2082844800000ms from Unix epoch
  const ms = -2082844800000 + fields.creationTimeSecs * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  const year = d.getUTCFullYear()
  if (year < 2000 || year > 2035) return null
  return d.toISOString().slice(0, 19) // "YYYY-MM-DDTHH:MM:SS"
}

// Priority 4: datetime pattern in filename (e.g. VID_20250315_143022, 2025_03_08_14_03_35_IMG)
function filenameDatePattern(filename: string): string | null {
  const m = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`)
  const now = Date.now()
  const tenYearsAgo = now - 10 * 365.25 * 24 * 60 * 60 * 1000
  if (isNaN(parsed.getTime()) || parsed.getTime() <= tenYearsAgo || parsed.getTime() > now) return null
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

/**
 * Extract both creation date and duration from a video file's binary header.
 * Reads only the first 512KB — one read, no playback required.
 *
 * Creation date priority:
 *   1. com.apple.quicktime.creationdate (iOS)
 *   2. ©day atom (Android, GoPro, cameras)
 *   3. mvhd.creation_time (non-iOS; skipped if 0)
 *   4. Filename datetime pattern
 *   5. null
 *
 * Duration: from mvhd timescale+duration fields, null if not found.
 */
export async function extractFileMetadata(
  file: File
): Promise<{ creationDate: string | null; duration: number | null }> {
  try {
    const buffer = await file.slice(0, 512 * 1024).arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)

    // Parse mvhd once — shared by date (priority 3) and duration
    const mvhd = parseMvhd(bytes, view)

    // Creation date cascade
    const creationDate =
      findAppleCreationDate(bytes) ??
      findCopyDayAtom(bytes, view) ??
      (mvhd ? mvhdCreationDate(mvhd) : null) ??
      filenameDatePattern(file.name)

    // Duration from mvhd
    let duration: number | null = null
    if (mvhd && mvhd.timescale > 0 && mvhd.duration > 0) {
      const secs = mvhd.duration / mvhd.timescale
      if (secs > 0 && secs <= 86400) duration = Math.round(secs)
    }

    return { creationDate, duration }
  } catch {
    return { creationDate: null, duration: null }
  }
}

/**
 * Parse video duration in seconds directly from an ArrayBuffer containing
 * MP4/MOV header bytes. Returns null if mvhd atom is not found.
 */
export function parseDurationFromBuffer(buffer: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const fields = parseMvhd(bytes, view)
  if (!fields || fields.timescale === 0 || fields.duration === 0) return null
  const secs = fields.duration / fields.timescale
  if (secs <= 0 || secs > 86400) return null
  return Math.round(secs)
}

// ─── Browser video element helpers ──────────────────────────────────────────

/**
 * Fast metadata-only extraction. Loads only the file header —
 * no seeking, no canvas, no frame decoding.
 * Typically resolves in <100ms even on mobile.
 */
export async function extractVideoMetadata(
  file: File
): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url)
      resolve({ duration: null, width: null, height: null })
    }, 5000)

    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve({
        duration: isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      })
    }

    video.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve({ duration: null, width: null, height: null })
    }

    video.src = url
  })
}

/**
 * Client-side video thumbnail generation using the browser's native canvas API.
 * No WASM, no dependencies, no network download required.
 */

export async function generateThumbnail(
  file: File
): Promise<{ blob: Blob; dataUrl: string; duration: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    let settled = false

    function cleanup() {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      fn()
    }

    // Overall timeout — if nothing happens within 10s, bail out
    const overallTimeout = setTimeout(() => {
      settle(() => {
        cleanup()
        reject(new Error('Thumbnail generation timed out'))
      })
    }, 10000)

    function captureFrame() {
      clearTimeout(overallTimeout)
      const dur = isFinite(video.duration) ? video.duration : null
      const w = video.videoWidth || null
      const h = video.videoHeight || null

      const canvas = document.createElement('canvas')
      const targetWidth = 640
      const scale = targetWidth / (video.videoWidth || targetWidth)
      canvas.width = targetWidth
      canvas.height = Math.round((video.videoHeight || 360) * scale)

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        settle(() => {
          cleanup()
          reject(new Error('Canvas 2D context unavailable'))
        })
        return
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          settle(() => {
            cleanup()
            if (!blob) {
              reject(new Error('Failed to export thumbnail'))
              return
            }
            const dataUrl = URL.createObjectURL(blob)
            resolve({ blob, dataUrl, duration: dur, width: w, height: h })
          })
        },
        'image/webp',
        0.8
      )
    }

    // Timeout fallback: if seeking to 1s stalls (some Android codecs), fall back to frame 0
    let seekFallbackTimer: ReturnType<typeof setTimeout> | null = null

    video.onloadedmetadata = () => {
      const seekTo = video.duration > 1 ? 1 : 0
      video.currentTime = seekTo

      // If onseeked doesn't fire within 3s, capture whatever frame is available
      seekFallbackTimer = setTimeout(() => {
        captureFrame()
      }, 3000)
    }

    video.onseeked = () => {
      if (seekFallbackTimer) {
        clearTimeout(seekFallbackTimer)
        seekFallbackTimer = null
      }
      captureFrame()
    }

    video.onerror = () => {
      clearTimeout(overallTimeout)
      if (seekFallbackTimer) clearTimeout(seekFallbackTimer)
      settle(() => {
        cleanup()
        reject(new Error('Could not load video for thumbnail'))
      })
    }

    video.src = url
  })
}
