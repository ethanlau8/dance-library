// ─── MP4/MOV date extraction ────────────────────────────────────────────────
//
// The single source of truth for reading a recording date out of an MP4/MOV
// container. Imported by both the browser (WEBSITE/src/lib/ffmpeg.ts) and the
// extract-recorded-at edge function.
//
// It lives here, under supabase/functions/_shared, because the Deno bundler is
// the fussier of the two consumers: a path it cannot resolve fails at deploy
// time, whereas a path Vite cannot resolve fails loudly at `tsc -b`. Put the
// file where the quiet failure would be, and let the loud one reach for it.
//
// Everything below is PURE — no I/O, no File, no S3, no timezone database.
// Acquiring bytes differs per environment (File.slice vs an R2 range request)
// and so does venue policy, so both are injected. That keeps this module fully
// testable and stops the two callers from drifting apart, which is exactly how
// the previous three copies of this logic ended up disagreeing.

export type DateSource = 'apple_atom' | 'cday_atom' | 'mvhd' | 'filename' | 'unknown'
export type DatePrecision = 'second' | 'minute' | 'day' | 'unknown'

export interface ExtractedDate {
  /** ISO 8601 instant, or null when the container carries no usable date. */
  instant: string | null
  /** Real UTC offset in minutes, only ever set from the Apple atom. */
  offsetMinutes: number | null
  source: DateSource
  precision: DatePrecision
}

export interface MvhdFields {
  creationTimeSecs: number
  timescale: number
  duration: number
}

export interface ExtractOptions {
  /**
   * Resolve a zone-less wall clock to an instant. A container that records no
   * offset is stating local time at the camera, which is venue policy rather
   * than container semantics — so the caller decides.
   */
  wallClockToInstant: (wallClock: string) => string | null
  /** Used only for the filename fallback. */
  filename?: string
  /** Clamp for plausibility. Defaults to 2000–2035. */
  minYear?: number
  maxYear?: number
}

// Mac HFS+ epoch: 1904-01-01T00:00:00Z, in ms relative to the Unix epoch.
const MP4_EPOCH_MS = -2_082_844_800_000

const APPLE_KEY = 'com.apple.quicktime.creationdate'

/** No date could be determined. */
export const NO_DATE: ExtractedDate = {
  instant: null,
  offsetMinutes: null,
  source: 'unknown',
  precision: 'unknown',
}

/**
 * Fetch bytes [start, endInclusive]. Supplied by the caller: the browser slices
 * a File, the edge function issues an R2 range request.
 */
export type ByteReader = (start: number, endInclusive: number) => Promise<Uint8Array>

/**
 * A `moov` atom larger than this is not worth fetching whole. Measured across
 * the library: `mvhd` always sits at moov+12, and the Apple creation-date key
 * is a median 64KB deep with a maximum of 193KB — 256KB covered 100% of files.
 */
export const MOOV_FETCH_LIMIT = 262_144

// ─── Byte helpers ───────────────────────────────────────────────────────────

export function findSequence(
  bytes: Uint8Array,
  pattern: ArrayLike<number>,
  startFrom = 0,
): number {
  outer: for (let i = startFrom; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer
    }
    return i
  }
  return -1
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0))
}

/**
 * Parse one atom header.
 *
 * Both callers walk the top-level atom table, but they acquire the 16 bytes
 * differently — the browser slices a File, the edge function issues a range
 * request. Only this decoding is shared.
 *
 * `size === 1` means a 64-bit size follows the type; `size === 0` means the
 * atom runs to the end of the file.
 */
export function parseAtomHeader(
  header: Uint8Array,
  fileSize: number,
  position: number,
): { type: string; size: number } | null {
  if (header.length < 8) return null
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  let size = view.getUint32(0, false)
  const type = String.fromCharCode(header[4], header[5], header[6], header[7])
  if (size === 1) {
    if (header.length < 16) return null
    const hi = view.getUint32(8, false)
    const lo = view.getUint32(12, false)
    size = hi * 0x1_0000_0000 + lo
  }
  if (size === 0) size = fileSize - position
  if (size < 8) return null
  return { type, size }
}

/**
 * Walk the top-level atom table to locate `moov`.
 *
 * Hopping is the only approach that works generally. Reading a fixed prefix
 * finds `moov` only in faststart files; native iPhone recordings put `mdat`
 * first and `moov` at the very end, hundreds of megabytes in. But `mdat`'s size
 * field states exactly how far to jump, so three to five 16-byte reads land on
 * `moov` wherever it is. Measured across the library: p50 of 5 requests.
 *
 * `maxHops` bounds the walk so a malformed file cannot spin.
 */
export async function findMoov(
  read: ByteReader,
  fileSize: number,
  maxHops = 12,
): Promise<{ offset: number; size: number } | null> {
  let pos = 0
  for (let hop = 0; hop < maxHops; hop++) {
    if (pos < 0 || pos + 8 > fileSize) return null
    const header = await read(pos, Math.min(pos + 15, fileSize - 1))
    const parsed = parseAtomHeader(header, fileSize, pos)
    if (!parsed) return null
    if (parsed.type === 'moov') return { offset: pos, size: parsed.size }
    pos += parsed.size
  }
  return null
}

/** Read `moov` and extract date and duration together — one fetch, both answers. */
export async function readMoovMetadata(
  read: ByteReader,
  fileSize: number,
  opts: ExtractOptions,
): Promise<{ date: ExtractedDate; duration: number | null }> {
  const moov = await findMoov(read, fileSize)
  if (!moov) return { date: NO_DATE, duration: null }
  const end = moov.offset + Math.min(moov.size, MOOV_FETCH_LIMIT) - 1
  const bytes = await read(moov.offset, Math.min(end, fileSize - 1))
  return {
    date: extractDate(bytes, opts),
    duration: durationSecondsFromMvhd(parseMvhd(bytes)),
  }
}

// ─── mvhd ───────────────────────────────────────────────────────────────────

export function parseMvhd(bytes: Uint8Array): MvhdFields | null {
  const idx = findSequence(bytes, ascii('mvhd'))
  if (idx === -1) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let offset = idx + 4
  if (offset + 4 > bytes.length) return null
  const version = bytes[offset]
  offset += 4 // version(1) + flags(3)

  let creationTimeSecs: number
  let timescale: number
  let duration: number

  if (version === 0) {
    if (offset + 16 > bytes.length) return null
    creationTimeSecs = view.getUint32(offset, false)
    offset += 8 // creation + modification
    timescale = view.getUint32(offset, false)
    duration = view.getUint32(offset + 4, false)
  } else if (version === 1) {
    if (offset + 28 > bytes.length) return null
    creationTimeSecs = view.getUint32(offset, false) * 0x1_0000_0000 + view.getUint32(offset + 4, false)
    offset += 16 // creation + modification, both 64-bit
    timescale = view.getUint32(offset, false)
    duration = view.getUint32(offset + 4, false) * 0x1_0000_0000 + view.getUint32(offset + 8, false)
  } else {
    return null
  }

  return { creationTimeSecs, timescale, duration }
}

export function durationSecondsFromMvhd(fields: MvhdFields | null): number | null {
  if (!fields || fields.timescale <= 0 || fields.duration <= 0) return null
  const secs = fields.duration / fields.timescale
  if (secs <= 0 || secs > 86_400) return null
  return Math.round(secs)
}

// ─── Date string normalisation ──────────────────────────────────────────────

/**
 * Rewrite a basic-format offset (`-0700`) to extended (`-07:00`).
 *
 * The ECMAScript Date Time String Format requires the colon. Engines that
 * accept the basic form do so by implementation-specific heuristic, so relying
 * on it makes parsing browser-dependent.
 */
export function normalizeOffset(text: string): string {
  return text.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
}

/** Offset in minutes east of UTC, or null if the string carries none. */
export function offsetMinutesOf(text: string): number | null {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(text.trim())
  if (!m) return null
  const mins = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -mins : mins
}

function hasExplicitZone(text: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(text)
}

/**
 * Turn a container date string into an instant.
 *
 * Parsing and validation are deliberately the same function. Splitting them —
 * a `new Date()` gate in front of a stricter normaliser — lets a value pass
 * validation and then silently become null, which is how RFC 1123 `©day`
 * values were being dropped.
 */
export function toInstant(text: string, opts: ExtractOptions): string | null {
  if (!text || text.trim().length < 10) return null
  const s = normalizeOffset(text)

  let iso: string | null
  if (hasExplicitZone(s)) {
    const d = new Date(s)
    iso = isNaN(d.getTime()) ? null : d.toISOString()
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    iso = opts.wallClockToInstant(s)
  } else {
    // RFC 1123 and friends already denote an instant.
    const d = new Date(s)
    iso = isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (!iso) return null

  // Range-check in UTC. Using the local year would make acceptance depend on
  // the viewer's timezone near the boundaries.
  const year = new Date(iso).getUTCFullYear()
  const min = opts.minYear ?? 2000
  const max = opts.maxYear ?? 2035
  return year >= min && year <= max ? iso : null
}

// ─── The four sources ───────────────────────────────────────────────────────

const ISO_LIKE = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[+\-Z][^\x00-\x1f]{0,6})?)/

/** iOS ground truth: carries a real UTC offset. */
export function findAppleCreationDate(bytes: Uint8Array): string | null {
  const idx = findSequence(bytes, ascii(APPLE_KEY))
  if (idx === -1) return null
  const slice = bytes.subarray(idx, Math.min(idx + 4096, bytes.length))
  const text = new TextDecoder().decode(slice)
  const m = ISO_LIKE.exec(text) ?? /(\d{4}-\d{2}-\d{2})/.exec(text)
  return m ? m[1] : null
}

/** ©day — QuickTime user data (Android, GoPro, cameras). May be date-only. */
export function findCopyDayAtom(bytes: Uint8Array): string | null {
  const tag = [0xa9, 0x64, 0x61, 0x79] // ©day
  const idx = findSequence(bytes, tag)
  if (idx === -1) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Format A — QuickTime udta: ['©day'][2B len][2B lang][UTF-8]
  if (idx + 8 < bytes.length) {
    const strLen = view.getUint16(idx + 4, false)
    if (strLen > 0 && strLen < 256 && idx + 8 + strLen <= bytes.length) {
      const text = new TextDecoder().decode(bytes.subarray(idx + 8, idx + 8 + strLen)).trim()
      if (text.length >= 4) return text
    }
  }

  // Format B — iTunes meta: a nearby 'data' sub-atom.
  const dataIdx = findSequence(bytes, ascii('data'), idx + 4)
  if (dataIdx !== -1 && dataIdx < idx + 256) {
    const valStart = dataIdx + 12 // 'data' + type_flag + locale
    const text = new TextDecoder()
      .decode(bytes.subarray(valStart, Math.min(valStart + 256, bytes.length)))
      .replace(/\0.*/s, '')
      .trim()
    if (text.length >= 4) return text
  }
  return null
}

/** mvhd.creation_time — a UTC instant. iOS frequently leaves it zero. */
export function mvhdCreationInstant(fields: MvhdFields | null): string | null {
  if (!fields || fields.creationTimeSecs === 0) return null
  const d = new Date(MP4_EPOCH_MS + fields.creationTimeSecs * 1000)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** A timestamp in the filename is a wall clock written by the capturing device. */
export function filenameWallClock(filename: string | undefined): string | null {
  if (!filename) return null
  const m = /(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})/.exec(filename)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

// ─── The cascade ────────────────────────────────────────────────────────────

/**
 * Extract a recording date from a buffer containing the `moov` atom.
 *
 * Priority reflects trustworthiness: only the Apple atom states a real offset,
 * mvhd gives an instant with the offset unknown, and a filename gives a wall
 * clock that venue policy has to resolve.
 */
export function extractDate(moovBytes: Uint8Array, opts: ExtractOptions): ExtractedDate {
  const none: ExtractedDate = {
    instant: null,
    offsetMinutes: null,
    source: 'unknown',
    precision: 'unknown',
  }

  const apple = findAppleCreationDate(moovBytes)
  if (apple) {
    const instant = toInstant(apple, opts)
    if (instant) {
      return {
        instant,
        offsetMinutes: offsetMinutesOf(normalizeOffset(apple)),
        source: 'apple_atom',
        precision: apple.includes(':') ? 'second' : 'day',
      }
    }
  }

  const cday = findCopyDayAtom(moovBytes)
  if (cday) {
    const instant = toInstant(cday, opts)
    if (instant) {
      return {
        instant,
        offsetMinutes: offsetMinutesOf(normalizeOffset(cday)),
        source: 'cday_atom',
        precision: /\d{2}:\d{2}/.test(cday) ? 'second' : 'day',
      }
    }
  }

  const mvhd = mvhdCreationInstant(parseMvhd(moovBytes))
  if (mvhd) {
    const instant = toInstant(mvhd, opts)
    // mvhd states UTC but not where the camera was, so the offset stays unknown.
    if (instant) return { instant, offsetMinutes: null, source: 'mvhd', precision: 'second' }
  }

  const wallClock = filenameWallClock(opts.filename)
  if (wallClock) {
    const instant = toInstant(wallClock, opts)
    if (instant) return { instant, offsetMinutes: null, source: 'filename', precision: 'second' }
  }

  return none
}
