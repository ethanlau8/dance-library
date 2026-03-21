export interface Role {
  id: string
  name: string
  view_media: boolean
  upload_media: boolean
  edit_metadata: boolean
  delete_media: boolean
  manage_roles: boolean
  create_tags: boolean
  manage_folders: boolean
  created_at: string
}

export interface Profile {
  id: string
  role_id: string | null
  display_name: string
  created_at: string
}

export interface ProfileWithRole extends Profile {
  role: Role | null
}

export interface Media {
  id: string
  title: string
  description: string | null
  media_type: string
  storage_path: string
  thumbnail_path: string | null
  duration: number | null
  recorded_at: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
}

export interface TagCategory {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface Tag {
  id: string
  name: string
  description: string | null
  category_id: string
  is_folder: boolean
  created_by: string
  created_at: string
}

export interface MediaTag {
  id: string
  media_id: string
  tag_id: string
  start_time: number | null
  end_time: number | null
  created_by: string
  created_at: string
}

export interface WatchProgress {
  id: string
  user_id: string
  media_id: string
  position: number
  updated_at: string
}

export interface Permissions {
  view_media: boolean
  upload_media: boolean
  edit_metadata: boolean
  delete_media: boolean
  manage_roles: boolean
  create_tags: boolean
  manage_folders: boolean
}

export interface MediaWithTags extends Media {
  tags?: Tag[]
}

export interface FolderWithCount {
  id: string
  name: string
  video_count: number
}

export interface ContinueWatchingItem {
  id: string
  title: string
  thumbnail_path: string | null
  duration: number | null
  position: number
  updated_at: string
}

export interface TimestampTag {
  id: string
  media_id: string
  tag_id: string
  start_time: number
  end_time: number | null
  tag_name: string
  category_name: string
}
