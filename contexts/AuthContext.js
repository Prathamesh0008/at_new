'use client';

import { createContext, useContext, useState } from 'react';
import { employees } from '@/utils/constants';
import { normalizeRole } from '@/utils/roles';

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
  const [user, setUser] = useState(() => getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getStoredUser()));
  const [loading] = useState(false);

  const login = (employeeId, password) => {
    const normalizedEmployeeId = String(employeeId || '').trim().toUpperCase();
    const employee = employees.find(
      (emp) => String(emp.id || '').trim().toUpperCase() === normalizedEmployeeId && emp.password === password
    );

    if (!employee) {
      return { success: false, message: 'Invalid Employee ID or password' };
    }

    const userData = {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      shift: employee.shift,
      role: normalizeRole(employee.role),
      department: employee.department,
      dateOfJoining: employee.dateOfJoining || null,
    };

    setUser(userData);
    setIsAuthenticated(true);
    localStorage.setItem('user', JSON.stringify(userData));

    return { success: true, user: userData };
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('user');
  };

  const value = {
    user,
    isAuthenticated,
    login,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
