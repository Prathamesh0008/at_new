'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { employees } from '@/utils/constants';
import { normalizeRole } from '@/utils/roles';
import { clearManagerBrowserSession } from '@/utils/manager-logout.mjs';
import { establishManagerSession } from '@/lib/manager-login.mjs';
import { portalReads } from '@/lib/portal-read-policy.mjs';
const AuthContext = createContext();

const getStoredUser = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const storedUser = localStorage.getItem('user');
  if (!storedUser) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedUser);
    if (!parsed?.id) return parsed;

    const matchedEmployee = employees.find((emp) => emp.id === parsed.id);
    if (!matchedEmployee) {
      return { ...parsed, role: normalizeRole(parsed.role) };
    }

    return {
      ...parsed,
      role: normalizeRole(matchedEmployee.role || parsed.role),
    };
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

export function AuthProvider({ children }) {
  const loginGeneration = useRef(0);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState('');
  const [managerSessionError, setManagerSessionError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const storedUser = getStoredUser();
    setUser(storedUser);
    setIsAuthenticated(Boolean(storedUser));
    setLoading(false);
  }, []);

  const login = async (employeeId, password) => {
    const attempt = ++loginGeneration.current;
    const normalizedEmployeeId = String(employeeId || '').trim().toUpperCase();
    const employee = employees.find(emp => String(emp.id || '').trim().toUpperCase() === normalizedEmployeeId);
    if (!employee || (employee.id !== 'NTS-MGR' && employee.password !== password)) {
      return { success: false, message: 'Invalid Employee ID or password' };
    }
    setManagerSessionError('');
    if (employee.id === 'NTS-MGR') {
      try { await establishManagerSession(password); }
      catch (error) {
        if (attempt === loginGeneration.current) setManagerSessionError(error.message);
        // Legacy portal access is not attendance authorization. Manager writes
        // still require the private server credential and protected cookie.
        if (employee.password !== password) return { success: false, message: error.message };
      }
    }
    if (attempt !== loginGeneration.current) return { success: false, message: 'Sign-in cancelled. Please try again.' };
    const userData = {
      id: employee.id, name: employee.name, email: employee.email, phone: employee.phone,
      shift: employee.shift, role: normalizeRole(employee.role), department: employee.department,
      dateOfJoining: employee.dateOfJoining || null,
    };
    setUser(userData);
    portalReads.invalidate();
    setLogoutError('');
    setIsAuthenticated(true);
    setLoading(false);
    localStorage.setItem('user', JSON.stringify(userData));
    return { success: true, user: userData };
  };

  const logout = async () => {
    if (loggingOut) return false;
    loginGeneration.current++;
    setLoggingOut(true);
    setLogoutError('');
    try { await clearManagerBrowserSession(); }
    catch (error) {
      setLogoutError(error.message);
      setLoggingOut(false);
      return false;
    }
    portalReads.invalidate();
    setUser(null);
    setIsAuthenticated(false);
    setLoading(false);
    localStorage.removeItem('user');
    setLoggingOut(false);
    return true;
  };

  const value = { user, isAuthenticated, login, logout, loading, logoutError, loggingOut, managerSessionError };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
