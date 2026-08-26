import { describe, it, expect } from 'vitest'
import {
  parseAtomHeader,
  parseMvhd,
  durationSecondsFromMvhd,
  mvhdCreationInstant,
  findAppleCreationDate,
  findCopyDayAtom,
  filenameWallClock,
  normalizeOffset,
  offsetMinutesOf,
  toInstant,
  extractDate,
  type ExtractOptions,
} from '@shared/mp4Date.ts'
import { fromVenueDatetimeLocal } from './venue'

// Fixtures are built here rather than checked in as binaries: a hand-written
// atom is inspectable and adjustable, and the parser only ever sees bytes.

const enc = new TextEncoder()

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function atomHeader(type: string, size: number): number[] {
  return [...u32(size), ...enc.encode(type)]
}

/** mvhd v0: 'mvhd' + version/flags + creation + modification + timescale + duration */
function mvhdV0(creationSecs: number, timescale = 600, duration = 18_000): Uint8Array {
  return new Uint8Array([
    ...enc.encode('mvhd'),
    0, 0, 0, 0, // version 0 + flags
    ...u32(creationSecs),
    ...u32(creationSecs), // modification
    ...u32(timescale),
    ...u32(duration),
  ])
}

function mvhdV1(creationSecs: number, timescale = 600, duration = 18_000): Uint8Array {
  return new Uint8Array([
    ...enc.encode('mvhd'),
    1, 0, 0, 0, // version 1 + flags
    ...u32(0), ...u32(creationSecs), // 64-bit creation
    ...u32(0), ...u32(creationSecs), // 64-bit modification
    ...u32(timescale),
    ...u32(0), ...u32(duration), // 64-bit duration
  ])
}

/** The Apple key followed by its ISO value, as it appears inside moov/meta/ilst. */
function appleAtom(value: string): Uint8Array {
  return new Uint8Array([
    ...enc.encode('com.apple.quicktime.creationdate'),
    ...atomHeader('data', 16 + value.length),
    0, 0, 0, 1, 0, 0, 0, 0,
    ...enc.encode(value),
  ])
}

/** ©day, QuickTime udta format: tag + 2B length + 2B language + UTF-8 */
function cdayUdta(value: string): Uint8Array {
  const bytes = enc.encode(value)
  return new Uint8Array([
    0xa9, 0x64, 0x61, 0x79,
    (bytes.length >> 8) & 0xff, bytes.length & 0xff,
    0, 0,
    ...bytes,
  ])
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// 1904 epoch. 2025-11-23T02:07:20Z is this many seconds after 1904-01-01.
const SECS_2025_11_23 = Math.round(
  (Date.parse('2025-11-23T02:07:20Z') - Date.parse('1904-01-01T00:00:00Z')) / 1000,
)

// Venue policy is injected, exactly as the real callers do it.
const opts: ExtractOptions = { wallClockToInstant: fromVenueDatetimeLocal }

describe('parseAtomHeader', () => {
  it('reads a plain 32-bit atom', () => {
    expect(parseAtomHeader(new Uint8Array(atomHeader('moov', 36_134)), 61_371_509, 20))
      .toEqual({ type: 'moov', size: 36_134 })
  })

  it('reads a 64-bit extended size', () => {
    const header = new Uint8Array([...u32(1), ...enc.encode('mdat'), ...u32(0), ...u32(5_000_000_000 % 0x100000000)])
    const parsed = parseAtomHeader(header, 9e9, 0)
    expect(parsed?.type).toBe('mdat')
  })

  it('treats size 0 as "runs to end of file"', () => {
    expect(parseAtomHeader(new Uint8Array(atomHeader('mdat', 0)), 1000, 100))
      .toEqual({ type: 'mdat', size: 900 })
  })

  it('rejects a corrupt size', () => {
    expect(parseAtomHeader(new Uint8Array(atomHeader('mdat', 4)), 1000, 0)).toBeNull()
    expect(parseAtomHeader(new Uint8Array([0, 0, 0]), 1000, 0)).toBeNull()
  })
})

describe('parseMvhd', () => {
  it('reads version 0', () => {
    const f = parseMvhd(mvhdV0(SECS_2025_11_23))
    expect(f?.creationTimeSecs).toBe(SECS_2025_11_23)
    expect(f?.timescale).toBe(600)
  })

  it('reads version 1 (64-bit)', () => {
    const f = parseMvhd(mvhdV1(SECS_2025_11_23))
    expect(f?.creationTimeSecs).toBe(SECS_2025_11_23)
    expect(f?.timescale).toBe(600)
  })

  it('returns null when there is no mvhd', () => {
    expect(parseMvhd(enc.encode('no atoms here at all'))).toBeNull()
  })
})

describe('durationSecondsFromMvhd', () => {
  it('divides duration by timescale', () => {
    expect(durationSecondsFromMvhd(parseMvhd(mvhdV0(SECS_2025_11_23, 600, 18_000)))).toBe(30)
  })

  it('rejects implausible values', () => {
    expect(durationSecondsFromMvhd(parseMvhd(mvhdV0(SECS_2025_11_23, 600, 0)))).toBeNull()
    expect(durationSecondsFromMvhd(parseMvhd(mvhdV0(SECS_2025_11_23, 0, 100)))).toBeNull()
    // more than 24h
    expect(durationSecondsFromMvhd(parseMvhd(mvhdV0(SECS_2025_11_23, 1, 90_000)))).toBeNull()
  })
})

describe('mvhdCreationInstant', () => {
  it('converts from the 1904 epoch to a UTC instant', () => {
    expect(mvhdCreationInstant(parseMvhd(mvhdV0(SECS_2025_11_23))))
      .toBe('2025-11-23T02:07:20.000Z')
  })

  it('treats zero as absent — iOS routinely leaves it unset', () => {
    expect(mvhdCreationInstant(parseMvhd(mvhdV0(0)))).toBeNull()
  })
})

describe('normalizeOffset / offsetMinutesOf', () => {
  it('rewrites basic-format offsets to extended', () => {
    // -0700 is not valid per the ECMAScript Date Time String Format; engines
    // that accept it do so by heuristic.
    expect(normalizeOffset('2026-05-05T22:14:02-0700')).toBe('2026-05-05T22:14:02-07:00')
    expect(normalizeOffset('2026-05-05T22:14:02-07:00')).toBe('2026-05-05T22:14:02-07:00')
  })

  it('reads the offset in minutes east of UTC', () => {
    expect(offsetMinutesOf('2026-05-05T22:14:02-07:00')).toBe(-420)
    expect(offsetMinutesOf('2026-01-05T22:14:02-08:00')).toBe(-480)
    expect(offsetMinutesOf('2026-05-05T22:14:02+05:45')).toBe(345)
    expect(offsetMinutesOf('2026-05-05T22:14:02Z')).toBeNull()
    expect(offsetMinutesOf('2026-05-05T22:14:02')).toBeNull()
  })
})

describe('toInstant', () => {
  it('accepts every shape a container actually uses', () => {
    expect(toInstant('2026-05-05T22:14:02-0700', opts)).toBe('2026-05-06T05:14:02.000Z')
    expect(toInstant('2025-11-23T02:07:20Z', opts)).toBe('2025-11-23T02:07:20.000Z')
    expect(toInstant('2015-03-08T14:03:35', opts)).toBe('2015-03-08T21:03:35.000Z')
    expect(toInstant('2015-03-08', opts)).toBe('2015-03-08T08:00:00.000Z')
    expect(toInstant('2015-03-08 14:03:35', opts)).toBe('2015-03-08T21:03:35.000Z')
    // Splitting validation from normalisation used to drop this one silently.
    expect(toInstant('Sat, 15 Mar 2025 14:30:00 GMT', opts)).toBe('2025-03-15T14:30:00.000Z')
  })

  it('rejects non-dates and out-of-range years', () => {
    expect(toInstant('2015', opts)).toBeNull()
    expect(toInstant('garbage', opts)).toBeNull()
    expect(toInstant('1999-01-01T00:00:00Z', opts)).toBeNull()
    expect(toInstant('2036-01-01T00:00:00Z', opts)).toBeNull()
  })

  it('range-checks in UTC so acceptance does not depend on the viewer', () => {
    // 2035-12-31T23:30-08:00 is 2036 in UTC and must be rejected identically
    // from every timezone the suite runs in.
    expect(toInstant('2035-12-31T23:30:00-08:00', opts)).toBeNull()
  })
})

describe('findAppleCreationDate', () => {
  it('finds the value after the key', () => {
    const moov = concat(new Uint8Array(64), appleAtom('2026-05-05T22:14:02-0700'), new Uint8Array(32))
    expect(findAppleCreationDate(moov)).toBe('2026-05-05T22:14:02-0700')
  })

  it('returns null when the key is absent', () => {
    expect(findAppleCreationDate(new Uint8Array(256))).toBeNull()
  })
})

describe('findCopyDayAtom', () => {
  it('reads the QuickTime udta form', () => {
    expect(findCopyDayAtom(concat(new Uint8Array(16), cdayUdta('2015-03-08T14:03:35'))))
      .toBe('2015-03-08T14:03:35')
  })

  it('reads a date-only value', () => {
    expect(findCopyDayAtom(concat(new Uint8Array(16), cdayUdta('2015-03-08')))).toBe('2015-03-08')
  })
})

describe('filenameWallClock', () => {
  it('reads the common camera and messenger patterns', () => {
    expect(filenameWallClock('VID_20250315_143022.mp4')).toBe('2025-03-15T14:30:22')
    expect(filenameWallClock('2025_03_08_14_03_35_IMG_5400.MOV')).toBe('2025-03-08T14:03:35')
    expect(filenameWallClock('VIDEO-2026-04-09-09-36-49.mp4')).toBe('2026-04-09T09:36:49')
  })

  it('returns null when there is no timestamp', () => {
    expect(filenameWallClock('IMG_1234.MOV')).toBeNull()
    expect(filenameWallClock(undefined)).toBeNull()
  })
})

describe('extractDate cascade', () => {
  it('prefers the Apple atom and keeps its real offset', () => {
    const moov = concat(mvhdV0(SECS_2025_11_23), appleAtom('2026-05-05T22:14:02-0700'))
    expect(extractDate(moov, opts)).toEqual({
      instant: '2026-05-06T05:14:02.000Z',
      offsetMinutes: -420,
      source: 'apple_atom',
      precision: 'second',
    })
  })

  it('falls back to mvhd, leaving the offset unknown', () => {
    // mvhd states UTC but not where the camera was.
    expect(extractDate(mvhdV0(SECS_2025_11_23), opts)).toEqual({
      instant: '2025-11-23T02:07:20.000Z',
      offsetMinutes: null,
      source: 'mvhd',
      precision: 'second',
    })
  })

  it('falls back to ©day when mvhd is zeroed', () => {
    const moov = concat(mvhdV0(0), cdayUdta('2015-03-08T14:03:35'))
    const r = extractDate(moov, opts)
    expect(r.source).toBe('cday_atom')
    expect(r.instant).toBe('2015-03-08T21:03:35.000Z')
  })

  it('falls back to the filename when the container carries nothing', () => {
    // The WhatsApp case: metadata stripped, timestamp only in the name.
    const r = extractDate(mvhdV0(0), { ...opts, filename: 'VIDEO-2026-04-09-09-36-49.mp4' })
    expect(r.source).toBe('filename')
    // Venue-local, not UTC — treating it as UTC is the silent 7-hour error.
    expect(r.instant).toBe('2026-04-09T16:36:49.000Z')
    expect(r.offsetMinutes).toBeNull()
  })

  it('reports unknown when there is genuinely no date', () => {
    expect(extractDate(mvhdV0(0), opts)).toEqual({
      instant: null,
      offsetMinutes: null,
      source: 'unknown',
      precision: 'unknown',
    })
  })
})
