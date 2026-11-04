"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, post, setToken, SESSION_ENDED_EVENT } from "./api";

export type Role = "EMPLOYEE" | "LINE_MANAGER" | "HOD" | "HR" | "FINANCE" | "ADMIN" | "MANAGEMENT";

export type User = {
  id: number;
  code: string;
  email: string;
  fullName: string;
  roles: Role[];
  departmentId: number | null;
  managerId: number | null;
  mustChangePassword: boolean;
  designation: string | null;
  department: string | null;
  manager: string | null;
  hasTeam: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadUser() {
  if (!getToken()) return null;
  try {
    return await api<User>("/auth/me");
  } catch {
    setToken(null);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadUser().then((u) => {
      if (cancelled) return;
      setUser(u);
      setLoading(false);
    });
    // The API client fires this when the server rejects the token; the portal layout then redirects to /login.
    const ended = () => setUser(null);
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_ENDED_EVENT, ended);
    };
  }, []);

  const refresh = useCallback(async () => {
    setUser(await loadUser());
  }, []);

  const login = async (email: string, password: string) => {
    const { token } = await post<{ token: string }>("/auth/login", { email, password });
    setToken(token);
    const me = await api<User>("/auth/me");
    setUser(me);
    return me;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const hasRole = (user: User | null, ...roles: Role[]) => !!user && roles.some((r) => user.roles.includes(r));

export const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: "Employee",
  LINE_MANAGER: "Line Manager",
  HOD: "Head of Department",
  HR: "HR",
  FINANCE: "Finance",
  ADMIN: "Admin",
  MANAGEMENT: "Management",
};
