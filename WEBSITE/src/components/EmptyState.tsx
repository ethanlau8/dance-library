import { useAuth } from '../contexts/AuthContext'

export default function EmptyState() {
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="mb-4 text-2xl font-bold">Dance Library</h1>
      <p className="mb-6 text-center text-gray-600">
        Your account has been created. Let the site owner know so they can give you access.
      </p>
      <button
        onClick={signOut}
        className="rounded bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
      >
        Log Out
      </button>
    </div>
  )
}
