import { transition, indiaDate } from './attendance-model.mjs';
import { deny } from './portal-policy.mjs';
const validKey = key => typeof key === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(key);
const iso = value => value instanceof Date && !Number.isNaN(+value) ? value.toISOString() : value?.toDate ? value.toDate().toISOString() : typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
// Bounded legacy reconciliation. Ambiguous source records fail closed rather
// than allowing a duplicate start or manufacturing an active shift.
async function legacyState(tx, db, Filter, user, date) {
  const read = async name => {
    const snap = await tx.get(db.collection(name).where(Filter.or(Filter.where('employeeId', '==', user.id), Filter.where('empId', '==', user.id))).where('date', '==', date).limit(101));
    if (snap.docs.length > 100) deny('Attendance reconciliation limit exceeded', 409);
    return snap.docs.map(doc => doc.data());
  };
  const [events, breaks] = await Promise.all([read('attendance'), read('breaks')]);
  const state = { employeeId: user.id, date, version: 0, breaks: [], activeBreak: null };
  const timeline = [...events.map(row => ({ ...row, kind: 'shift' })), ...breaks.map(row => ({ ...row, kind: 'break' }))];
  if (timeline.some(row => (row.employeeId && row.employeeId !== user.id) || (row.empId && row.empId !== user.id) || !iso(row.timestamp))) deny('Legacy attendance needs administrator reconciliation', 409);
  timeline.sort((a, b) => Date.parse(iso(a.timestamp)) - Date.parse(iso(b.timestamp)));
  let current = state;
  for (const row of timeline) {
    if (row.kind === 'break' && !row.action) deny('Legacy break state needs administrator reconciliation', 409);
    current = transition(current, row.action, iso(row.timestamp), row.breakType);
  }
  return current;
}
export function createEmployeeAttendance({ db, Filter, stamp, now = () => new Date() }) {
  return async (user, command = null, { breakOperation = false } = {}) => {
    if (!user?.id) deny('Authentication required', 401);
    if (user.id === 'NTS-MGR') deny('Use the protected manager endpoint');
    const instant = now(), today = indiaDate(instant), pointer = db.collection('attendanceState').doc(user.id);
    const run = command ? work => db.runTransaction(work, { maxAttempts: 1 }) : work => work({ get: ref => ref.get() });
    return run(async tx => {
      const pointerSnap = await tx.get(pointer);
      const pointerData = pointerSnap.exists ? pointerSnap.data() : null;
      if (pointerData && pointerData.employeeId !== user.id) deny();
      if (pointerData && (!/^\d{4}-\d{2}-\d{2}$/.test(pointerData.date || '') || !Number.isSafeInteger(pointerData.version) || pointerData.version < 0 || !Array.isArray(pointerData.breaks) || (pointerData.startTime && !iso(pointerData.startTime)) || (pointerData.endTime && !iso(pointerData.endTime)) || (pointerData.activeBreak && (!iso(pointerData.activeBreak.startTime) || !['Tea','Lunch','Evening'].includes(pointerData.activeBreak.breakType))))) deny('Stored attendance state requires administrator review', 409);
      const date = pointerData?.startTime && !pointerData.endTime ? pointerData.date : today;
      let state = pointerData?.date === date ? pointerData : await legacyState(tx, db, Filter, user, date);
      const shiftId = `${user.id}_${date}`;
      const dailyRef = db.collection('attendanceDaily').doc(shiftId);
      const daily = await tx.get(dailyRef);
      if (daily.exists) {
        const row = daily.data();
        if (!(row.employeeId || row.empId) || (row.employeeId && row.employeeId !== user.id) || (row.empId && row.empId !== user.id) || (row.date && row.date !== date)) deny();
        if (!pointerData) {
          const start = row.startTime || row.shiftStartTime, end = row.endTime || row.shiftEndTime;
          if ((start && (!iso(start) || iso(start) !== state.startTime)) || (end && (!iso(end) || iso(end) !== state.endTime))) deny('Legacy daily shift needs administrator reconciliation', 409);
        }
      }
      state = { ...state, employeeId: user.id, date, version: state.version || 0 };
      if (!command) return { date, shiftId, version: state.version, state };
      const { action, breakType, command: expected } = command;
      if (!expected || Object.keys(expected).some(key => !['key','date','shiftId','expectedVersion'].includes(key)) || !validKey(expected.key) || expected.date !== date || expected.shiftId !== shiftId || !Number.isSafeInteger(expected.expectedVersion)) deny('Stale attendance command; refresh state', 409);
      if (breakOperation ? !['start', 'end'].includes(action) || !['Tea', 'Lunch', 'Evening'].includes(breakType) : !['clock-in', 'clock-out'].includes(action)) deny('Invalid attendance action', 400);
      const receiptRef = db.collection('attendanceCommandReceipts').doc(`${user.id}_${expected.key}`);
      const receipt = await tx.get(receiptRef);
      const payload = JSON.stringify({ action, breakType: breakType || null, ...expected });
      if (receipt.exists) {
        if (receipt.data().employeeId !== user.id || receipt.data().date !== date || receipt.data().payload !== payload) deny('Idempotency key reused for a different command', 409);
        return { date, shiftId, version: state.version, state, duplicate: true };
      }
      if (expected.expectedVersion !== state.version) deny('Attendance changed; refresh state', 409);
      const next = transition(state, action, instant.toISOString(), breakType);
      next.version = state.version + 1;
      next.employeeId = user.id; next.employeeName = user.name;
      const eventRef = db.collection(breakOperation ? 'breaks' : 'attendance').doc(`${shiftId}_${next.version}`);
      tx.set(pointer, next);
      tx.set(dailyRef, { ...next, shiftStartTime: next.startTime || null, shiftEndTime: next.endTime || null, clockInVerified: true, estimated: false, source: 'verified_employee_daily' }, { merge: true });
      tx.create(eventRef, { employeeId: user.id, employeeName: user.name, date, action, ...(breakOperation ? { breakType, status: action === 'start' ? 'Active' : 'Completed' } : { shift: '10:00 AM - 7:00 PM', clockInVerified: true, isLate: action === 'clock-in' && instant.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }) > '10:00:00' }), timestamp: stamp(), createdAt: stamp(), time: instant.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }), source: 'verified_employee_daily' });
      if (!breakOperation && action === 'clock-out' && state.activeBreak) {
        tx.create(db.collection('breaks').doc(`${shiftId}_${next.version}_shift_close`), { employeeId: user.id, employeeName: user.name, date, action: 'end', breakType: state.activeBreak.breakType, status: 'Completed', timestamp: stamp(), createdAt: stamp(), source: 'shift_end_closes_break' });
      }
      tx.create(receiptRef, { employeeId: user.id, date, payload, createdAt: stamp() });
      return { date, shiftId, version: next.version, state: next };
    });
  };
}
