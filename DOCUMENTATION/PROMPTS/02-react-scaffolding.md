# Prompt 2 — React Project Scaffolding + Auth & Routing

## Context

We are building **Dance Library**, a private role-gated web app for organizing and browsing dance videos. Docs:
- Feature design: `DOCUMENTATION/feature-design.md`
- UX design: `DOCUMENTATION/ux-design.md`
- Data architecture: `DOCUMENTATION/data-architecture.md`

The Supabase schema, RLS policies, Edge Functions, and Cloudflare Worker were implemented in Prompt 1.

**Tech stack:**
- React (with TypeScript)
- Vite (build tool, with `base` path set for GitHub Pages)
- React Router v6 (client-side routing with hash-based routing for GitHub Pages compatibility)
- Supabase JS client for auth and database
- Tailwind CSS for styling (mobile-first)
- GitHub Actions for deployment to GitHub Pages

---

## Task

Scaffold the complete React project with:
1. Project setup and configuration
2. Supabase client
3. Auth context + permission hook
4. Route structure with guards
5. Shell layout (header + hamburger menu)
6. Placeholder pages for all routes
7. GitHub Actions deploy workflow

Do not implement the actual content of any screen yet — just the skeleton, routing, and auth flow working end-to-end.

---

## 1. Project Setup

Initialize with Vite:
```bash
npm create vite@latest . -- --template react-ts
npm install
```

Install dependencies:
```bash
npm install @supabase/supabase-js react-router-dom
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**`vite.config.ts`:** Set `base` to `'/dance-library/'` (or the actual repo name) for GitHub Pages.

**`tailwind.config.js`:** Configure content paths to include `./src/**/*.{ts,tsx}`.

**`.env.local`** (gitignored):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_THUMBNAIL_BASE_URL=
```

---

## 2. Supabase Client

`src/lib/supabase.ts`:
- Initialize and export the Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

---

## 3. Types

`src/types/index.ts`:

Define TypeScript interfaces for all the core data models matching the database schema:
- `Role` (with all permission flags)
- `Profile` (with `role_id`, `display_name`, `created_at`)
- `ProfileWithRole` (Profile joined with Role)
- `Media` (all columns)
- `Tag` (all columns)
- `TagCategory`
- `MediaTag` (with optional `start_time`, `end_time`)
- `WatchProgress`

Also define a `Permissions` type that mirrors the Role permission flags, for use in the auth context.

---

## 4. Auth Context

`src/contexts/AuthContext.tsx`:

Provide a context with:
- `user`: Supabase `User | null`
- `profile`: `ProfileWithRole | null` — the user's profile joined with their role
- `permissions`: `Permissions | null` — the user's permission flags (null if no role)
- `loading`: boolean — true while the initial session check is in progress
- `signIn(email, password)`: calls `supabase.auth.signInWithPassword`
- `signUp(email, password, displayName)`: calls `supabase.auth.signUp`
- `signOut()`: calls `supabase.auth.signOut`

On mount, call `supabase.auth.getSession()` to restore session. Subscribe to `supabase.auth.onAuthStateChange` to keep the user in sync.

When a session exists, fetch the user's profile with their role:
```sql
SELECT p.*, r.*
FROM profiles p
LEFT JOIN roles r ON p.role_id = r.id
WHERE p.id = <user.id>
```

Expose the profile's role flags directly as `permissions` for convenient access.

---

## 5. Permission Hook

`src/hooks/usePermissions.ts`:

A simple hook that returns `permissions` from `AuthContext`. Include a helper `can(flag: keyof Permissions): boolean` that safely returns false if permissions is null.

---

## 6. Route Structure

`src/App.tsx`:

Use `HashRouter` (required for GitHub Pages — no server-side routing).

Routes:
| Path | Component | Guard |
|---|---|---|
| `/` | `HomePage` | Requires auth + role |
| `/video/:id` | `VideoDetailPage` | Requires auth + role |
| `/folder/:tagId` | `FolderPage` | Requires auth + role |
| `/upload` | `UploadPage` | Requires auth + `upload_media` |
| `/admin` | `AdminPage` | Requires auth + `manage_roles` |
| `/tags` | `TagsPage` | Requires auth + role |
| `/login` | `LoginPage` | Redirect to `/` if already authenticated with role |

### Route guards

Create a `ProtectedRoute` component that:
1. While `loading` is true: render a full-screen loading spinner
2. If no `user`: redirect to `/login`
3. If `user` exists but `profile.role_id` is null: render the **EmptyState** component (no role assigned)
4. If a specific permission is required and user doesn't have it: redirect to `/`
5. Otherwise: render the children

---

## 7. Shell Layout

`src/components/Layout.tsx`:

A wrapper rendered inside protected routes. Contains:

**Header bar:**
- Left: App title "Dance Library" (links to `/`)
- Right: Upload button `[+]` (only if user has `upload_media`) + hamburger menu icon `[≡]`

**Hamburger menu** (slides in from right or renders as an overlay):
- "All Videos" → `/`
- "Folders" → scrolls to Folders section on home, or a standalone `/folders` list (your choice)
- "Tags" → `/tags`
- "Admin" → `/admin` (only if user has `manage_roles`)
- "Log Out" → calls `signOut()`

The layout should be full-height with the header fixed at the top and content scrolling below.

---

## 8. Placeholder Pages

Create stub components for each page that simply render the page name. They will be filled in by subsequent prompts:

- `src/pages/HomePage.tsx`
- `src/pages/VideoDetailPage.tsx`
- `src/pages/FolderPage.tsx`
- `src/pages/UploadPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/TagsPage.tsx`
- `src/pages/LoginPage.tsx` — implement this one fully (see below)

---

## 9. Login Page (implement fully)

`src/pages/LoginPage.tsx`:

A centered single-page form with:
- App title at the top
- Email input
- Password input
- Submit button (text: "Log In" or "Sign Up" depending on mode)
- Toggle link: "Don't have an account? Sign Up" / "Already have an account? Log In"

In Sign Up mode: show an optional Display Name field.

On submit:
- Call `signIn` or `signUp` from `AuthContext`
- Show inline error messages on failure (e.g., "Invalid email or password")
- On success: React Router will handle the redirect via the auth state change

---

## 10. Empty State (implement fully)

`src/components/EmptyState.tsx`:

Rendered when a logged-in user has no role assigned.

Display:
- App title
- Message: "Your account has been created. Let the site owner know so they can give you access."
- "Log Out" button (calls `signOut`)

No navigation, no hamburger menu — just the message and log out.

---

## 11. GitHub Actions Deploy Workflow

`.github/workflows/deploy.yml`:

On push to `main`:
1. Checkout repo
2. Setup Node.js
3. Run `npm ci`
4. Run `npm run build` with environment variables injected from GitHub secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_THUMBNAIL_BASE_URL`)
5. Deploy the `dist/` folder to GitHub Pages using `actions/deploy-pages`

---

## Expected File Structure

```
src/
  lib/
    supabase.ts
  types/
    index.ts
  contexts/
    AuthContext.tsx
  hooks/
    usePermissions.ts
  components/
    Layout.tsx
    EmptyState.tsx
    ProtectedRoute.tsx
  pages/
    LoginPage.tsx
    HomePage.tsx
    VideoDetailPage.tsx
    FolderPage.tsx
    UploadPage.tsx
    AdminPage.tsx
    TagsPage.tsx
  App.tsx
  main.tsx
  index.css
.github/
  workflows/
    deploy.yml
vite.config.ts
tailwind.config.js
```

---

## Notes

- Use `HashRouter` not `BrowserRouter` — GitHub Pages doesn't support server-side routing, so hash-based URLs (`/#/video/123`) are required.
- All styling should be mobile-first Tailwind. Prefer simple utility classes. Do not over-style placeholder pages.
- The auth context `loading` state is critical — without it, protected routes will flash a redirect before the session is restored. Make sure `loading` stays true until `getSession()` resolves.
