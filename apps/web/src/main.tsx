import { lazy, Suspense, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Shell, Notice } from './components';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { HistoryPage } from './pages/HistoryPage';
import { InvitePage } from './pages/InvitePage';
import { SummaryPage } from './pages/SummaryPage';
import './styles.css';
import './features/space/space.css';
import './features/space/immersion.css';
import './experience.css';
import './features/space/personal.css';
import { RouteAnnouncer } from './navigation';

const RoomPage = lazy(() => import('./pages/RoomPage').then((m) => ({ default: m.RoomPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const PersonalSpacePage = lazy(() =>
  import('./pages/PersonalSpacePage').then((m) => ({ default: m.PersonalSpacePage })),
);

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? (
    children
  ) : (
    <Navigate
      to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  );
}
function App() {
  const { loading, error, refresh, user } = useAuth();
  return (
    <Shell>
      <RouteAnnouncer />
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
          <Suspense
            fallback={
              <section className="empty-state" role="status">
                正在打开页面…
              </section>
            }
          >
            <Routes key={user?.id ?? 'anonymous'}>
              <Route
                path="/space"
                element={
                  <Protected>
                    <PersonalSpacePage />
                  </Protected>
                }
              />
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
          </Suspense>
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
