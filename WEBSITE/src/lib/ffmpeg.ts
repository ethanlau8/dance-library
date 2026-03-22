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

    function cleanup() {
      URL.revokeObjectURL(url)
    }

    function captureFrame() {
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
        cleanup()
        reject(new Error('Canvas 2D context unavailable'))
        return
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          cleanup()
          if (!blob) {
            reject(new Error('Failed to export thumbnail'))
            return
          }
          const dataUrl = URL.createObjectURL(blob)
          resolve({ blob, dataUrl, duration: dur, width: w, height: h })
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
      if (seekFallbackTimer) clearTimeout(seekFallbackTimer)
      cleanup()
      reject(new Error('Could not load video for thumbnail'))
    }

    video.src = url
  })
}
