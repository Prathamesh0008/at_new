export const MANAGER_ID = 'NTS-MGR';
export const HISTORY_START = '2025-10-10';
export const HISTORY_END = '2026-11-13';
export const BREAK_TYPES = ['Tea', 'Lunch', 'Evening', 'Breather'];
export function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
export function managerIdentity(identity) {
  if (!identity?.uid || identity.employeeId !== MANAGER_ID) fail('Manager authentication required', 403);
}
export function dateInIndia(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function normalizedDate(value) {
  if (validDate(value)) return value;
  if (value?.toDate) return dateInIndia(value.toDate());
  if (value instanceof Date && !Number.isNaN(+value)) return dateInIndia(value);
  fail('Unsupported or missing legacy date; administrator reconciliation required');
}
export function monthBounds(month, historical = false) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || month < '2025-10' || month > '2100-12') fail('Invalid month', 400);
  let start = `${month}-01`;
  let end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  if (historical) {
    if (month > HISTORY_END.slice(0, 7)) fail('Month outside historical period', 400);
    start = start < HISTORY_START ? HISTORY_START : start;
    end = end > HISTORY_END ? HISTORY_END : end;
  }
  return { start, end };
}
export function daysBetween(start, end) {
  const days = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}
// One shift and at most one break of each supported type per day. No auto-close.
export function dailyTransition(prior, action, breakType, stamp, date) {
  if (!validDate(date) || date <= HISTORY_END) fail('Daily attendance must be after the historical period');
  if (prior && (prior.employeeId !== MANAGER_ID || prior.date !== date || prior.estimated !== false)) fail('Invalid daily record');
  const next = prior ? { ...prior, breaks: { ...prior.breaks } } : null;
  if (action === 'start') {
    if (prior) fail('Shift already started');
    return { employeeId: MANAGER_ID, date, attendanceStatus: 'Present', estimated: false, source: 'verified_manager_daily', clockInVerified: true, clockIn: stamp, clockOut: null, breaks: {}, activeBreak: null, state: 'working', schedule: '10:00-19:00 Asia/Kolkata' };
  }
  if (!prior || prior.state === 'ended') fail('No open shift');
  if (action === 'end') {
    if (prior.activeBreak) fail('End the active break first');
    return { ...next, state: 'ended', clockOut: stamp };
  }
  if (!BREAK_TYPES.includes(breakType)) fail('Invalid break type', 400);
  if (action === 'break-start') {
    if (prior.activeBreak || prior.breaks?.[breakType]) fail('Break already used or another break is active');
    next.breaks[breakType] = { start: stamp, end: null };
    return { ...next, activeBreak: breakType, state: 'break' };
  }
  if (action === 'break-end') {
    if (prior.activeBreak !== breakType || !prior.breaks?.[breakType] || prior.breaks[breakType].end) fail('This break is not active');
    next.breaks[breakType] = { ...next.breaks[breakType], end: stamp };
    return { ...next, activeBreak: null, state: 'working' };
  }
  fail('Invalid attendance action', 400);
}
