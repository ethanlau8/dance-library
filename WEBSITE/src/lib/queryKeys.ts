export const queryKeys = {
  media: {
    all: ['media'] as const,
    list: (filters: {
      sortBy: string
      tagIds: string[]
      tagMode?: string
      fromDate: string | null
      toDate: string | null
      folderTagId: string | null
      mediaType: string | null
    }) => ['media', 'list', filters] as const,
    detail: (id: string) => ['media', 'detail', id] as const,
    signedUrl: (id: string) => ['media', 'signedUrl', id] as const,
  },
  tags: {
    all: ['tags'] as const,
    withCategories: () => ['tags', 'withCategories'] as const,
    byIds: (ids: string[]) => ['tags', 'byIds', ids] as const,
    usageCounts: () => ['tags', 'usageCounts'] as const,
  },
  tagCategories: {
    all: ['tagCategories'] as const,
  },
  mediaTags: {
    byMedia: (mediaId: string) => ['mediaTags', mediaId] as const,
  },
  folders: {
    all: ['folders'] as const,
  },
  continueWatching: (userId: string) => ['continueWatching', userId] as const,
  watchProgress: (mediaId: string) => ['watchProgress', mediaId] as const,
}
