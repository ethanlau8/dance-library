// ─── Video file metadata ────────────────────────────────────────────────────
//
// The MP4/MOV parsing itself lives in @shared/mp4Date.ts, shared verbatim with
// the extract-recorded-at edge function. This file is only the browser adapter:
// it turns a File into a byte reader and supplies venue policy. Keeping the
// parser in one place is deliberate — three divergent copies of it are why 29
// records ended up with no date at all.

import { readMoovMetadata, NO_DATE } from '@shared/mp4Date.ts'
import type { ByteReader, ExtractedDate } from '@shared/mp4Date.ts'
import { fromVenueDatetimeLocal } from './venue'

/**
 * Extract the recording date and duration from a video file.
 *
 * Walks the atom table rather than reading a fixed prefix. A File is
 * random-access at no cost — slice() reads nothing until awaited — so the
 * browser can hop to `moov` exactly as the server does. Reading a fixed prefix
 * instead is why this returned null for the 318 of 404 library files that place
 * `moov` at the end.
 *
 * `date.instant` is always a true instant or null; provenance travels with it
 * so the upload can attribute the value without re-deriving it server-side.
 */
export async function extractFileMetadata(
  file: File,
): Promise<{ date: ExtractedDate; duration: number | null }> {
  const nothing = { date: NO_DATE, duration: null }
  try {
    const read: ByteReader = async (start, endInclusive) =>
      new Uint8Array(await file.slice(start, endInclusive + 1).arrayBuffer())

    // Bounded, because reading a File is not always cheap. A video picked from
    // the iOS Photos library may still live in iCloud, and seeking to the end —
    // which a trailing `moov` requires — can force the whole file to be
    // materialised first. On a large clip over cellular that stalls for
    // minutes, and the upload form must never wait on it.
    //
    // Giving up costs a pre-filled date, nothing more: extract-recorded-at
    // reads the same bytes server-side after the upload and is authoritative.
    return await withDeadline(
      readMoovMetadata(read, file.size, {
        wallClockToInstant: fromVenueDatetimeLocal,
        filename: file.name,
      }),
      METADATA_DEADLINE_MS,
      nothing,
    )
  } catch {
    return nothing
  }
}

/** How long to let a local metadata read run before falling back to the server. */
const METADATA_DEADLINE_MS = 4_000

function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
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
