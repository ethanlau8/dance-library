import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// America/New_York: -05:00/-04:00, west of UTC, DST active, and NOT the venue.
//
// The companion to vitest.config.ts. A date built from Date.UTC and rendered in
// the viewer's zone only lands on the wrong day when that zone is west of UTC —
// which is how the filter chip came to display "Mar 14" when you selected
// Mar 15. An east-of-UTC suite passes straight through that bug, so the same
// tests are run from both sides.
//
// New York rather than the venue itself: if the suite ran in Pacific, every
// venue-pinned function would agree with browser-local time by coincidence and
// prove nothing.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      env: { TZ: 'America/New_York' },
      include: ['src/**/*.test.ts'],
    },
  }),
)
