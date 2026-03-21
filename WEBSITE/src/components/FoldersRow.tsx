import { useNavigate } from 'react-router-dom'
import type { FolderWithCount } from '../types'

interface FoldersRowProps {
  folders: FolderWithCount[]
}

export default function FoldersRow({ folders }: FoldersRowProps) {
  const navigate = useNavigate()

  if (folders.length === 0) return null

  return (
    <section className="mb-4">
      <h2 className="mb-2 px-4 text-sm font-semibold text-gray-700">Folders</h2>
      <div
        className="flex gap-3 overflow-x-auto px-4 pb-2"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => navigate(`/folder/${folder.id}`)}
            className="flex flex-shrink-0 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 hover:bg-gray-100"
            style={{ minWidth: '100px' }}
          >
            <span className="text-sm font-medium text-gray-900">{folder.name}</span>
            <span className="text-xs text-gray-500">{folder.video_count}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
