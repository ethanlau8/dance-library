import { describe, it, expect } from 'vitest'
import { classifyDrift } from '@shared/driftSignature.ts'

// This rule decides whether the backfill is allowed to overwrite a stored date,
// so the cases below are the real records it will be asked about.

const d = (iso: string) => new Date(iso)

describe('classifyDrift — real records from the library', () => {
  it('recognises a single PDT save (IMG_9686, +7h)', () => {
    // stored 2025-10-29T19:07:00Z, file 2025-10-29T05:07:08Z → 14h... two saves
    const v = classifyDrift(d('2025-10-29T19:07:00Z'), d('2025-10-29T05:07:08Z'))
    expect(v).toEqual({ isDrift: true, saves: 2, offsetMinutes: 420 })
  })

  it('recognises three PST saves (IMG_1142, 24h) despite the seconds gap', () => {
    // The stored value lost its :16 seconds, so a naive hour comparison reads
    // 23.9956h and lands 4 minutes inside a 24h threshold. At minute resolution
    // it is exactly 3 x 480.
    const v = classifyDrift(d('2026-01-22T06:05:00Z'), d('2026-01-21T06:05:16Z'))
    expect(v).toEqual({ isDrift: true, saves: 3, offsetMinutes: 480 })
  })

  it('recognises three PDT saves (IMG_7229, 21h)', () => {
    const v = classifyDrift(d('2026-05-01T02:39:00Z'), d('2026-04-30T05:39:05Z'))
    expect(v).toEqual({ isDrift: true, saves: 3, offsetMinutes: 420 })
  })

  it('refuses the two genuine mysteries', () => {
    // IMG_9772: 1843h out, not a multiple of any venue offset.
    expect(classifyDrift(d('2025-08-19T09:18:53Z'), d('2025-11-04T04:59:08Z')).isDrift).toBe(false)
    // IMG_9039: 874h out.
    expect(classifyDrift(d('2025-07-27T21:50:38Z'), d('2025-09-02T07:43:06Z')).isDrift).toBe(false)
  })
})

describe('classifyDrift — discrimination', () => {
  it('requires the truncated-seconds fingerprint', () => {
    // Same 7h gap, but the stored value kept its seconds, so it was not written
    // by the editor and must not be assumed safe to overwrite.
    expect(classifyDrift(d('2026-05-01T02:39:37Z'), d('2026-04-30T19:39:37Z')).isDrift).toBe(false)
  })

  it('rejects a gap that is not a whole number of offsets', () => {
    // 10h out: unexplained, however plausible it looks.
    expect(classifyDrift(d('2026-05-01T02:39:00Z'), d('2026-04-30T16:39:05Z')).isDrift).toBe(false)
  })

  it('rejects backwards gaps — the defect only ever moved values forward', () => {
    expect(classifyDrift(d('2026-04-30T05:39:00Z'), d('2026-05-01T02:39:05Z')).isDrift).toBe(false)
  })

  it('rejects an identical value', () => {
    expect(classifyDrift(d('2026-05-01T02:39:00Z'), d('2026-05-01T02:39:00Z')).isDrift).toBe(false)
  })

  it('caps how many saves it will explain', () => {
    // 8 x 420min is accepted; 9 is not — past that, "it fits a multiple" stops
    // being evidence and starts being coincidence.
    const actual = d('2026-04-30T05:39:05Z')
    const at = (n: number) => new Date(Math.floor(actual.getTime() / 60_000) * 60_000 + n * 420 * 60_000)
    expect(classifyDrift(at(8), actual).saves).toBe(8)
    expect(classifyDrift(at(9), actual).isDrift).toBe(false)
  })

  it('uses the offset in effect at the true recording time', () => {
    // A January recording drifts by 480, not 420 — using the wrong season's
    // offset would make a real drift look unexplained.
    expect(classifyDrift(d('2026-01-21T14:05:00Z'), d('2026-01-21T06:05:16Z')).offsetMinutes).toBe(480)
    expect(classifyDrift(d('2026-07-21T13:05:00Z'), d('2026-07-21T06:05:16Z')).offsetMinutes).toBe(420)
  })
})
