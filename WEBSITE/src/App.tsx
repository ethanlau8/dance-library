import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import VideoDetailPage from './pages/VideoDetailPage'
import FolderPage from './pages/FolderPage'
import UploadPage from './pages/UploadPage'
import AdminPage from './pages/AdminPage'
import TagsPage from './pages/TagsPage'

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout><HomePage /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/video/:id"
            element={
              <ProtectedRoute>
                <Layout><VideoDetailPage /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/folder/:tagId"
            element={
              <ProtectedRoute>
                <Layout><FolderPage /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute requiredPermission="upload_media">
                <Layout><UploadPage /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredPermission="manage_roles">
                <Layout><AdminPage /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tags"
            element={
              <ProtectedRoute>
                <Layout><TagsPage /></Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
