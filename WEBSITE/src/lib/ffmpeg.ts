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
