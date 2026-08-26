import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Merged with the Vite config so the @shared alias is defined in exactly one
// place — a vitest config otherwise replaces vite.config.ts rather than
// extending it, and the shared MP4 parser would fail to resolve under test.
//
// Asia/Tokyo: +09:00, east of UTC, no DST.
//
// Every date bug in this project came from code that silently used the
// *browser's* local time. Under TZ=UTC or TZ=America/Los_Angeles those bugs are
// invisible, because the wrong answer happens to equal the right one. Tokyo
// differs from both UTC and the venue, so venue-pinned functions that leak
// browser time give a visibly wrong answer.
//
// It cannot catch everything on its own: bugs that shift a date *backwards*
// only show up west of UTC. See vitest.config.west.ts — `npm test` runs both.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      env: { TZ: 'Asia/Tokyo' },
      include: ['src/**/*.test.ts'],
    },
  }),
)
