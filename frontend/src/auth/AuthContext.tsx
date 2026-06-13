// Auth state for the app: the current JWT plus login / register / logout.
// The token is mirrored into localStorage (token.ts) so it survives reloads.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin, register as apiRegister } from '../api/endpoints';
import { clearToken, getToken, setToken, setUnauthorizedHandler } from './token';

interface AuthValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const navigate = useNavigate();

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    navigate('/login');
  }, [navigate]);

  // Let the (non-React) API layer force a logout when it sees a 401.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setTokenState(null);
      navigate('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setToken(res.access_token);
    setTokenState(res.access_token);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await apiRegister(email, password);
    // Auto-login so a new user lands straight in the app.
    const res = await apiLogin(email, password);
    setToken(res.access_token);
    setTokenState(res.access_token);
  }, []);

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
