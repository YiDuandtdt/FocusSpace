import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Shell, Notice } from './components';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { HistoryPage } from './pages/HistoryPage';
import { InvitePage } from './pages/InvitePage';
import { AdminPage } from './pages/AdminPage';
import { SummaryPage } from './pages/SummaryPage';
import './styles.css';
import './features/space/space.css';

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? (
    children
  ) : (
    <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  );
}
function App() {
  const { loading, error, refresh, user } = useAuth();
  return (
    <Shell>
      {loading ? (
        <section className="empty-state">
          <h2>正在打开你的空间…</h2>
        </section>
      ) : error && !user ? (
        <section className="empty-state">
          <Notice>{error}</Notice>
          <button className="button primary" onClick={() => void refresh()}>
            重新连接
          </button>
        </section>
      ) : (
        <>
          {error ? (
            <Notice>
              {error}{' '}
              <button className="text-button" onClick={() => void refresh()}>
                重新连接
              </button>
            </Notice>
          ) : null}
          <Routes key={user?.id ?? 'anonymous'}>
            <Route
              path="/admin/*"
              element={
                <Protected>
                  <AdminPage />
                </Protected>
              }
            />
            <Route
              path="/history"
              element={
                <Protected>
                  <HistoryPage />
                </Protected>
              }
            />
            <Route
              path="/join/:code"
              element={
                <Protected>
                  <InvitePage />
                </Protected>
              }
            />
            <Route
              path="/sessions/:sessionId/summary"
              element={
                <Protected>
                  <SummaryPage />
                </Protected>
              }
            />
            <Route path="/login" element={<AuthPage key="login" />} />
            <Route path="/register" element={<AuthPage key="register" register />} />
            <Route
              path="/"
              element={
                <Protected>
                  <HomePage />
                </Protected>
              }
            />
            <Route
              path="/rooms/:roomId"
              element={
                <Protected>
                  <RoomPage />
                </Protected>
              }
            />
            <Route
              path="*"
              element={
                <section className="empty-state">
                  <h1>这里还没有座位</h1>
                  <Link to="/" className="button primary">
                    返回首页
                  </Link>
                </section>
              }
            />
          </Routes>
        </>
      )}
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
