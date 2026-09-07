import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Shell, Notice } from './components';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { SummaryPage } from './pages/SummaryPage';
import './styles.css';

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
  const { loading, error, refresh } = useAuth();
  return (
    <Shell>
      {loading ? (
        <section className="empty-state">
          <h2>正在打开你的空间…</h2>
        </section>
      ) : error ? (
        <section className="empty-state">
          <Notice>{error}</Notice>
          <button className="button primary" onClick={() => void refresh()}>
            重新连接
          </button>
        </section>
      ) : (
        <Routes>
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
