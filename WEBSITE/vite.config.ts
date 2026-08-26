import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// The MP4 date parser is shared with the Supabase edge functions and lives
// outside this package, so Vite needs both an alias to resolve @shared/* and
// permission to serve files from above the project root during dev.
const sharedDir = fileURLToPath(new URL('../SUPABASE/supabase/functions/_shared', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dance-library/',
  resolve: {
    alias: { '@shared': sharedDir },
  },
  server: {
    fs: { allow: ['.', sharedDir] },
  },
})
