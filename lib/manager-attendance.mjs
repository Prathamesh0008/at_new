export const MANAGER_EMPLOYEE_ID = 'NTS-MGR';
export const MANAGER_JOINING_DATE = '2025-10-10';
export const MANAGER_BACKFILL_END = '2026-11-11';
export const MANAGER_HOLIDAY_REVIEW_ID = 'NTS-MGR_holiday_review';
export const isAttendanceManager = user => user?.id === MANAGER_EMPLOYEE_ID && String(user.role).toLowerCase() === 'manager';
export function assertManagerBackfillTarget(employeeId = MANAGER_EMPLOYEE_ID) {
  if (employeeId !== MANAGER_EMPLOYEE_ID) throw Object.assign(new Error('Historical attendance is restricted to NTS-MGR'), { status: 403 });
}
