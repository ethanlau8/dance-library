import { describe, it, expect } from 'vitest'
import { buildRecordedAtFields } from './recordedAt'
import { findMoov, parseAtomHeader, type ByteReader, type ExtractedDate } from '@shared/mp4Date.ts'

const enc = new TextEncoder()
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** Build a fake file as a list of top-level atoms, and a reader over it. */
function fakeFile(atoms: Array<[string, number]>): { read: ByteReader; size: number; reads: number[] } {
  const parts: number[] = []
  for (const [type, size] of atoms) {
    parts.push(...u32(size), ...enc.encode(type))
    for (let i = 8; i < size; i++) parts.push(0)
  }
  const bytes = new Uint8Array(parts)
  const reads: number[] = []
  const read: ByteReader = async (start, endInclusive) => {
    reads.push(start)
    return bytes.subarray(start, endInclusive + 1)
  }
  return { read, size: bytes.length, reads }
}

describe('findMoov', () => {
  it('finds moov at the front (faststart)', async () => {
    const f = fakeFile([['ftyp', 20], ['moov', 200], ['mdat', 500]])
    expect(await findMoov(f.read, f.size)).toEqual({ offset: 20, size: 200 })
  })

  it('finds moov at the end, past a huge mdat', async () => {
    // The native iPhone layout, and the case a fixed-prefix read cannot reach:
    // 318 of 404 library files look like this.
    const f = fakeFile([['ftyp', 20], ['wide', 8], ['mdat', 4000], ['moov', 300]])
    expect(await findMoov(f.read, f.size)).toEqual({ offset: 4028, size: 300 })
  })

  it('hops rather than scanning — one read per atom', async () => {
    const f = fakeFile([['ftyp', 20], ['wide', 8], ['mdat', 100_000], ['moov', 300]])
    await findMoov(f.read, f.size)
    // ftyp, wide, mdat, moov — four headers, no linear search.
    expect(f.reads).toEqual([0, 20, 28, 100_028])
  })

  it('returns null when there is no moov', async () => {
    const f = fakeFile([['ftyp', 20], ['mdat', 500]])
    expect(await findMoov(f.read, f.size)).toBeNull()
  })

  it('gives up rather than spinning on a corrupt size', async () => {
    const bytes = new Uint8Array([...u32(4), ...enc.encode('junk'), ...new Array(100).fill(0)])
    const read: ByteReader = async (s, e) => bytes.subarray(s, e + 1)
    expect(await findMoov(read, bytes.length)).toBeNull()
  })

  it('bounds the walk with maxHops', async () => {
    const atoms: Array<[string, number]> = Array.from({ length: 40 }, () => ['free', 8])
    const f = fakeFile([...atoms, ['moov', 100]])
    expect(await findMoov(f.read, f.size, 5)).toBeNull()
    expect(await findMoov(f.read, f.size, 50)).not.toBeNull()
  })
})

describe('parseAtomHeader size-0 handling', () => {
  it('treats a zero size as running to end of file', () => {
    // Legal in QuickTime for the last atom.
    expect(parseAtomHeader(new Uint8Array([...u32(0), ...enc.encode('mdat')]), 1000, 100))
      .toEqual({ type: 'mdat', size: 900 })
  })
})

describe('buildRecordedAtFields', () => {
  const extracted: ExtractedDate = {
    instant: '2025-11-23T02:07:20.000Z',
    offsetMinutes: -480,
    source: 'apple_atom',
    precision: 'second',
  }

  it('carries the parser attribution through when the user did not edit', () => {
    expect(buildRecordedAtFields('2025-11-22T18:07:20', extracted, false)).toEqual({
      recorded_at: '2025-11-23T02:07:20.000Z',
      recorded_at_source: 'apple_atom',
      recorded_at_offset_minutes: -480,
      recorded_at_precision: 'second',
    })
  })

  it('marks an edited value manual and drops the stale offset', () => {
    // The extracted offset described the extracted instant, not the one the
    // user typed — asserting it would be a fabrication, and the backfill must
    // see 'manual' so it never overwrites the correction.
    expect(buildRecordedAtFields('2025-11-22T19:30:00', extracted, true)).toEqual({
      recorded_at: '2025-11-23T03:30:00.000Z',
      recorded_at_source: 'manual',
      recorded_at_offset_minutes: null,
      recorded_at_precision: 'second',
    })
  })

  it('marks manual when the parser found nothing but the user supplied a date', () => {
    expect(buildRecordedAtFields('2025-11-22T18:07:20', null, false).recorded_at_source).toBe('manual')
    const empty: ExtractedDate = { instant: null, offsetMinutes: null, source: 'unknown', precision: 'unknown' }
    expect(buildRecordedAtFields('2025-11-22T18:07:20', empty, false).recorded_at_source).toBe('manual')
  })

  it('leaves every column null when there is no date at all', () => {
    expect(buildRecordedAtFields('', extracted, false)).toEqual({
      recorded_at: null,
      recorded_at_source: null,
      recorded_at_offset_minutes: null,
      recorded_at_precision: null,
    })
  })

  it('never emits a source the CHECK constraint would reject', () => {
    const allowed = ['apple_atom', 'cday_atom', 'mvhd', 'filename', 'manual', 'inferred', 'unknown']
    for (const source of ['apple_atom', 'cday_atom', 'mvhd', 'filename'] as const) {
      const r = buildRecordedAtFields('2025-11-22T18:07:20', { ...extracted, source }, false)
      expect(allowed).toContain(r.recorded_at_source)
      expect(['second', 'minute', 'day', 'unknown']).toContain(r.recorded_at_precision)
    }
  })
})
