# Manual Setup Checklist

These are the steps that must be completed manually (in dashboards and CLIs) before or alongside code implementation. Complete these in order — later prompts depend on the IDs and environment variables produced here.

---

## 1. Supabase Project

- [ ] Create a new Supabase project at supabase.com
- [ ] Note down:
  - **Project URL** → `VITE_SUPABASE_URL`
  - **Anon public key** → `VITE_SUPABASE_ANON_KEY`
  - **Service role key** → `SUPABASE_SERVICE_ROLE_KEY` (used in Edge Functions only, never in frontend)
- [ ] In Auth settings: disable email confirmation (for a private app, this simplifies onboarding)
- [ ] In Auth settings: confirm email/password provider is enabled
- [ ] In Auth settings: disable all OAuth providers

---

## 2. Cloudflare Account & R2 Bucket

- [ ] Create a Cloudflare account if you don't have one
- [ ] In R2, create a new bucket (e.g., `dance-library`)
- [ ] Create an R2 API token with **Object Read & Write** permissions on that bucket
- [ ] Note down:
  - **R2 Account ID** → `R2_ACCOUNT_ID`
  - **R2 Access Key ID** → `R2_ACCESS_KEY_ID`
  - **R2 Secret Access Key** → `R2_SECRET_ACCESS_KEY`
  - **R2 Bucket Name** → `R2_BUCKET_NAME`
  - **R2 S3 endpoint** → `https://<account_id>.r2.cloudflarestorage.com`

---

## 3. Cloudflare Worker (Thumbnail Serving)

This Worker serves thumbnails publicly from R2 without requiring auth.

- [ ] Install Wrangler CLI: `npm install -g wrangler`
- [ ] Login: `wrangler login`
- [ ] Create a new Worker project (this will be implemented in Prompt 1)
- [ ] Bind the R2 bucket to the Worker in `wrangler.toml`:
  ```toml
  [[r2_buckets]]
  binding = "BUCKET"
  bucket_name = "dance-library"
  ```
- [ ] Deploy the Worker
- [ ] Note the Worker URL (e.g., `https://thumbs.<your-subdomain>.workers.dev`) → `VITE_THUMBNAIL_BASE_URL`
- [ ] Optional: set a custom domain for the Worker in Cloudflare dashboard

---

## 4. Supabase Edge Function Secrets

After the Supabase project is created, set the R2 secrets so Edge Functions can access R2:

```bash
supabase secrets set R2_ACCOUNT_ID=<value>
supabase secrets set R2_ACCESS_KEY_ID=<value>
supabase secrets set R2_SECRET_ACCESS_KEY=<value>
supabase secrets set R2_BUCKET_NAME=<value>
```

---

## 5. GitHub Repository & Pages

- [ ] Create a new GitHub repository (e.g., `dance-library`)
- [ ] In repository Settings → Pages:
  - Source: **GitHub Actions**
- [ ] Note the Pages URL (e.g., `https://<username>.github.io/dance-library`) — this will be needed for Supabase Auth allowed URLs
- [ ] In Supabase Auth settings → URL Configuration:
  - **Site URL**: your GitHub Pages URL
  - **Redirect URLs**: add your GitHub Pages URL

---

## 6. Environment Variables Summary

Create a `.env.local` file in the project root (never commit this):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_THUMBNAIL_BASE_URL=https://thumbs.<subdomain>.workers.dev
```

For GitHub Actions (CI/CD deployment), add these as repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_THUMBNAIL_BASE_URL`

---

## After This Checklist

Once the above is complete, run the prompts in order:

1. `01-supabase-backend.md` — Schema, RLS, triggers, Edge Functions, Cloudflare Worker code
2. `02-react-scaffolding.md` — Project setup, routing, auth layer
3. `03-home-screen.md` — Home screen with grid/feed, folders, continue watching
4. `04-video-detail.md` — Video detail page and playback
5. `05-upload-flow.md` — Upload page with ffmpeg.wasm thumbnail generation
6. `06-edit-mode.md` — Edit mode and timestamp management
7. `07-search-filter.md` — Search overlay and filter panel
8. `08-admin-tags.md` — Admin screen and tag management screen
