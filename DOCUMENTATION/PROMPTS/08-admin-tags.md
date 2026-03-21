# Prompt 8 — Admin Screen & Tag Management Screen

## Context

We are building **Dance Library**. All core screens are complete. This is the final implementation prompt.

Reference docs:
- Feature design §2 (Access & Roles), §3 (Permissions), §5 (Tagging): `DOCUMENTATION/feature-design.md`
- UX design §10 (Admin Screen), §13 (Tag Management): `DOCUMENTATION/ux-design.md`
- RLS policies in `DOCUMENTATION/data-architecture.md` §4

---

## Task

Implement:
1. **Admin screen** — user management and role assignment
2. **Tag management screen** — browse, search, toggle folder status, edit tag names

---

## 1. Admin Screen

`src/pages/AdminPage.tsx`

Accessible from the hamburger menu. Only rendered if the user has `manage_roles` (enforced by route guard).

### Layout

Two tabs: "Users" (default) and "Roles".

**Users tab:**

Fetch all profiles (the current user's RLS allows reading all profiles when they have `manage_roles`):
```sql
SELECT p.id, p.display_name, p.created_at,
       r.id as role_id, r.name as role_name
FROM profiles p
LEFT JOIN roles r ON p.role_id = r.id
ORDER BY p.created_at ASC
```

Split into two sections:
- **Pending** (role_id IS NULL) — ordered by created_at ASC (oldest first, so longest-waiting shows first)
- **Active** (role_id IS NOT NULL)

**Pending section:**
Each row: email (from auth — see note below), signup date, [Assign Role] dropdown.

The dropdown lists all available roles. Selecting a role immediately assigns it:
```sql
UPDATE profiles SET role_id = <selected_role_id> WHERE id = <profile_id>
```

After assignment, the user moves from Pending to Active.

**Active section:**
Each row: email, current role name, [Change] dropdown.

Constraints (enforced in UI and via RLS):
- The current user's own row shows their role but no [Change] control (cannot self-role-change)
- If the target user is the last remaining Owner, the [Change] dropdown is disabled with a tooltip: "Cannot change — last Owner"

**Note on email display:** The `profiles` table does not store email. Email lives in `auth.users`. Because the Supabase anon key can only read `auth.users` through RLS, you'll need to create a database function or view that joins `auth.users.email` with `profiles` — accessible only to users with `manage_roles`.

Create a Postgres function:
```sql
CREATE OR REPLACE FUNCTION public.get_users_with_emails()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  role_id UUID,
  role_name TEXT,
  created_at TIMESTAMPTZ
) AS $$
  SELECT p.id, u.email, p.display_name, p.role_id, r.name, p.created_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.roles r ON p.role_id = r.id
  ORDER BY p.created_at ASC;
$$ LANGUAGE sql SECURITY DEFINER;
```

Call this function from the frontend via `supabase.rpc('get_users_with_emails')`. The `SECURITY DEFINER` allows it to read `auth.users`, but RLS on the calling function ensures only `manage_roles` users can call it — enforce this by adding a check at the top of the function or by wrapping the call in an RLS policy.

Add this function to the Supabase migration or as a separate migration file.

**Roles tab:**

Display the three roles and their permission flags in a read-only table:

| Permission | Owner | Editor | Viewer |
|---|---|---|---|
| view_media | ✓ | ✓ | ✓ |
| upload_media | ✓ | ✓ | — |
| edit_metadata | ✓ | ✓ | — |
| delete_media | ✓ | — | — |
| manage_roles | ✓ | — | — |
| create_tags | ✓ | ✓ | — |
| manage_folders | ✓ | — | — |

Fetch from the `roles` table. No editing UI (deferred feature).

---

## 2. Tag Management Screen

`src/pages/TagsPage.tsx`

Accessible from the hamburger menu. Visible to all authenticated users with a role (read-only for Viewers).

### Layout

```
← Tags                      [+ New Tag]
┌────────────────────────────────────┐
│  🔍 Search tags...                 │
└────────────────────────────────────┘

Style
  bachata          [📁] [✎]
  salsa            [📁] [✎]
  zouk                  [✎]

Difficulty
  beginner              [✎]
  intermediate          [✎]
  advanced              [✎]
```

`[+ New Tag]` only visible if user has `create_tags`.
`[📁]` toggle only visible if user has `manage_folders`.
`[✎]` edit button only visible if user has `create_tags`.

### Data

Fetch all tags with categories (same query as filter panel). Display in a single scrollable list grouped by category.

### Search

Client-side filter — filter the in-memory tag list as the user types. No server query needed (the full tag list is small).

### Folder toggle (📁)

The 📁 icon appears on tags that currently have `is_folder = true`, and as a dimmed/outline icon on tags that don't.

On tap (requires `manage_folders`):
```sql
UPDATE tags SET is_folder = NOT is_folder WHERE id = <tag_id>
```

Update local state optimistically.

### Edit tag (✎)

On tap (requires `create_tags`): transform the tag row into an inline edit state:
```
[ cross-body lead input    ]  [Save] [Cancel]
```

Only name and description are editable. Category cannot be changed (it would break the uniqueness constraint semantics).

On Save:
```sql
UPDATE tags SET name = <new_name>, description = <new_desc> WHERE id = <tag_id>
```

If the name already exists in the same category, show an inline error.

### Create new tag

`[+ New Tag]` opens the same create tag sub-flow used in the TagPicker (from Prompt 5). After creation, add the new tag to the local list without re-fetching.

---

## Notes

- The `get_users_with_emails` SQL function added in this prompt should be added to the existing Supabase migration or as a new migration file `supabase/migrations/<timestamp>_admin_helpers.sql`.
- The RLS protection for the `get_users_with_emails` function: add a guard at the start of the function body:
  ```sql
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.manage_roles = true
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  ```
- On the Admin screen desktop layout, the user list can be a table with columns for email, role, signup date, and actions.
- The Tags screen is read-only for Viewers — show the full list without any action controls.
