import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearDrafts } from './preferences';
import type { User } from '@focusspace/shared';
import { api, errorMessage, RequestError } from './api';
type AuthState = {
  user: User | null;
  currentRoomId: string | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
};
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User; currentRoomId: string | null }>('/auth/me');
      setUser(data.user);
      setCurrentRoomId(data.currentRoomId);
      setError('');
    } catch (error) {
      if (error instanceof RequestError && error.code === 'UNAUTHORIZED') {
        setUser(null);
        setCurrentRoomId(null);
        setError('');
      } else setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => {
      clearDrafts();
      setUser(null);
      setCurrentRoomId(null);
    };
    const changed = (event: StorageEvent) => {
      if (event.key === 'focusspace:logout') {
        expired();
        void refresh();
      }
    };
    window.addEventListener('focusspace:unauthorized', expired);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('focusspace:unauthorized', expired);
      window.removeEventListener('storage', changed);
    };
  }, [refresh]);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    clearDrafts();
    try {
      localStorage.setItem('focusspace:logout', String(Date.now()));
    } catch {}
    setUser(null);
    setCurrentRoomId(null);
  };
  return (
    <Context.Provider value={{ user, currentRoomId, loading, error, refresh, setUser, logout }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
