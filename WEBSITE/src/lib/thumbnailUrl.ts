export function thumbnailUrl(path: string | null | undefined): string {
  if (!path) return '/dance-library/placeholder-thumbnail.png'
  const base = import.meta.env.VITE_THUMBNAIL_BASE_URL as string
  const protocol = base.startsWith('http') ? '' : 'https://'
  return `${protocol}${base}/${path}`
}
