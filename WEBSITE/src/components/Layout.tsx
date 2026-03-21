import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'

export default function Layout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { signOut } = useAuth()
  const { can } = usePermissions()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="fixed top-0 right-0 left-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
        <Link to="/" className="text-lg font-bold text-gray-900 no-underline">
          Dance Library
        </Link>
        <div className="flex items-center gap-2">
          {can('upload_media') && (
            <Link
              to="/upload"
              className="flex h-8 w-8 items-center justify-center rounded text-xl text-gray-700 hover:bg-gray-100"
            >
              +
            </Link>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded text-xl text-gray-700 hover:bg-gray-100"
          >
            ≡
          </button>
        </div>
      </header>

      {/* Menu overlay */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="fixed top-0 right-0 z-50 h-full w-64 bg-white shadow-lg">
            <div className="flex h-14 items-center justify-end px-4">
              <button
                onClick={() => setMenuOpen(false)}
                className="text-2xl text-gray-700"
              >
                ×
              </button>
            </div>
            <ul className="flex flex-col">
              <NavItem to="/" label="All Videos" onClick={() => setMenuOpen(false)} />
              <NavItem to="/tags" label="Tags" onClick={() => setMenuOpen(false)} />
              {can('manage_roles') && (
                <NavItem to="/admin" label="Admin" onClick={() => setMenuOpen(false)} />
              )}
              <li>
                <button
                  onClick={handleSignOut}
                  className="w-full px-6 py-3 text-left text-gray-700 hover:bg-gray-50"
                >
                  Log Out
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}

      {/* Content */}
      <main className="mt-14 flex-1">
        {children}
      </main>
    </div>
  )
}

function NavItem({ to, label, onClick }: { to: string; label: string; onClick: () => void }) {
  return (
    <li>
      <Link
        to={to}
        onClick={onClick}
        className="block px-6 py-3 text-gray-700 no-underline hover:bg-gray-50"
      >
        {label}
      </Link>
    </li>
  )
}
