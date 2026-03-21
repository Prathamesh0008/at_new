export const APP_ROLES = {
  MANAGER: "manager",
  EMPLOYEE: "employee",
};

const MANAGER_ALIASES = new Set(["manager", "admin", "model", "supervisor", "teamlead", "team_lead"]);
const EMPLOYEE_ALIASES = new Set(["employee", "agent", "user", "staff"]);

export const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase().replace(/\s+/g, "_");
  const compact = normalized.replace(/_/g, "");

  if (MANAGER_ALIASES.has(normalized) || MANAGER_ALIASES.has(compact)) {
    return APP_ROLES.MANAGER;
  }

  if (EMPLOYEE_ALIASES.has(normalized) || EMPLOYEE_ALIASES.has(compact)) {
    return APP_ROLES.EMPLOYEE;
  }

  return APP_ROLES.EMPLOYEE;
};

export const isManager = (role) => normalizeRole(role) === APP_ROLES.MANAGER;
export const isEmployee = (role) => normalizeRole(role) === APP_ROLES.EMPLOYEE;
