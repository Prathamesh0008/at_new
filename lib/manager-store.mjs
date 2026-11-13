import { createHash } from 'node:crypto';
import { MANAGER_ID, HISTORY_END, monthBounds, daysBetween, normalizedDate, dailyTransition, managerIdentity, fail, dateInIndia, validDate } from './manager-domain.mjs';
import { previewManagerHistory } from './manager-history.mjs';

export const HISTORY = 'managerAttendanceHistory';
export const DAILY = 'managerAttendanceDaily';
export const AUDIT = 'managerAttendanceApprovals';
export const CONFIRM = 'APPLY NTS-MGR HISTORICAL ESTIMATES';
export const QUERY_CAP = 100;
const digest = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const id = date => `${MANAGER_ID}_${date}`;
const data = snap => snap.exists ? snap.data() : null;
const get = (reader, ref) => reader.get(ref);
const matchesAudit = (record, audit, approvalId) => record.approvalId === approvalId && record.approvedBy === audit.approvedBy && record.reviewReason === audit.reason && record.reason === 'Manager historical attendance estimate' && !!record.approvedAt && !!audit.approvedAt && digest(record.approvedAt) === digest(audit.approvedAt);

function assertOwner(row) {
  if ((row.employeeId && row.employeeId !== MANAGER_ID) || (row.empId && row.empId !== MANAGER_ID) || !(row.employeeId || row.empId)) fail('Conflicting manager ownership requires review');
}
// Both supported ID fields, ISO date and Timestamp representations, month-bounded.
// No scans or fallback unbounded queries. Missing legacy date/schema coverage must
// be reconciled separately before activation; range queries cannot detect missing fields.
export async function reconcileMonth(reader, db, month, timestamp) {
  const { start, end } = monthBounds(month, true);
  const attendance = [], leaves = [], evidence = new Map();
  async function queryRows(name, field, bounds, kind) {
    let query = db.collection(name).where(field, '==', MANAGER_ID);
    for (const [key, op, value] of bounds) query = query.where(key, op, value);
    const result = await get(reader, query.limit(QUERY_CAP + 1));
    if (result.docs.length > QUERY_CAP) fail('Monthly reconciliation limit exceeded; manual review required');
    for (const snap of result.docs) {
      const path = `${name}/${snap.id}`;
      if (evidence.has(path)) continue;
      const row = snap.data(); assertOwner(row);
      evidence.set(path, { path, version: snap.updateTime?.toMillis?.() ?? null, row });
      if (kind === 'attendance') attendance.push({ ...row, date: normalizedDate(row.date) });
      else {
        const fromDate = normalizedDate(row.fromDate), toDate = normalizedDate(row.toDate);
        if (toDate < fromDate) fail('Invalid manager leave range');
        leaves.push({ ...row, fromDate, toDate });
      }
    }
  }
  for (const field of ['employeeId', 'empId']) {
    for (const name of ['attendance', 'attendanceDaily']) {
      await queryRows(name, field, [['date', '>=', start], ['date', '<=', end]], 'attendance');
    }
    for (const name of ['leave_requests', 'leave_requests_v2']) {
      await queryRows(name, field, [['fromDate', '<=', end], ['toDate', '>=', start]], 'leave');
      // IST calendar boundaries, including leaves that span the complete month.
      await queryRows(name, field, [['fromDate', '<=', timestamp(new Date(`${end}T23:59:59.999+05:30`))], ['toDate', '>=', timestamp(new Date(`${start}T00:00:00+05:30`))]], 'leave');
    }
  }
  // Our own actual daily records have stable IDs, and are never overwritten.
  for (const date of daysBetween(start, end)) {
    const snap = await get(reader, db.collection(DAILY).doc(id(date)));
    if (snap.exists) {
      const row = snap.data(); assertOwner(row);
      attendance.push({ ...row, date });
      evidence.set(`${DAILY}/${snap.id}`, { path: `${DAILY}/${snap.id}`, row });
    }
  }
  const model = previewManagerHistory({ attendance, leaves, reconciled: true });
  const proposal = model.months.find(m => m.month === month);
  const records = [];
  for (const date of daysBetween(start, end)) {
    const snap = await get(reader, db.collection(HISTORY).doc(id(date)));
    if (snap.exists) {
      const record = snap.data();
      if (record.date !== date || record.employeeId !== MANAGER_ID) fail('Historical document ID or owner mismatch');
      records.push({ ...record, id: snap.id });
    }
  }
  // Existing estimates do not alter absence selection, enabling exact safe retries.
  // They must match the proposed day/status before a month can be approved/applied.
  for (const record of records) {
    assertOwner(record);
    const day = proposal.days.find(d => d.date === record.date);
    const status = day?.status === 'Absent (Proposed)' ? 'Absent' : 'Present';
    if (!day?.eligible || record.estimated !== true || record.source !== 'admin_approved_historical_estimate' || record.attendanceStatus !== status || record.clockIn !== null || record.clockOut !== null || record.breaks !== null || record.clockInVerified !== false) proposal.review.push(`${record.date}: existing historical record conflicts with proposal`);
  }
  const fingerprint = digest({ month, proposal, evidence: [...evidence.values()].sort((a, b) => a.path.localeCompare(b.path)) });
  return { month, proposal, records, fingerprint };
}

export function createManagerStore({ db, stamp, timestamp }) {
  // Injection allows complete offline tests without importing Firebase.
  const direct = { get: ref => ref.get() };
  const transaction = fn => db.runTransaction(fn, { maxAttempts: 1 });
  return {
    async preview(identity, month) {
      managerIdentity(identity);
      return reconcileMonth(direct, db, month, timestamp);
    },
    async approve(identity, review, reason) {
      managerIdentity(identity);
      if (review.uid !== identity.uid || review.employeeId !== MANAGER_ID) fail('Approval identity mismatch', 403);
      if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) fail('Review reason must contain 10–500 characters', 400);
      reason = reason.trim();
      const approvalId = `${MANAGER_ID}_${review.month}_${digest([review.fingerprint, identity.uid, reason])}`;
      return transaction(async tx => {
        const current = await reconcileMonth(tx, db, review.month, timestamp);
        if (current.fingerprint !== review.fingerprint || current.proposal.review.length) fail('Preview changed or conflicts remain; generate and review again');
        const ref = db.collection(AUDIT).doc(approvalId);
        const prior = data(await tx.get(ref));
        if (!prior) tx.create(ref, { employeeId: MANAGER_ID, month: review.month, fingerprint: review.fingerprint, approvedBy: identity.uid, approvedAt: stamp(), reason, state: 'approved' });
        else if (prior.approvedBy !== identity.uid || prior.fingerprint !== review.fingerprint || prior.reason !== reason) fail('Approval audit conflict');
        return { approvalId, month: review.month, fingerprint: review.fingerprint };
      });
    },
    async apply(identity, review, confirmation) {
      managerIdentity(identity);
      if (confirmation !== CONFIRM) fail('Explicit application confirmation required', 400);
      if (review.uid !== identity.uid || review.employeeId !== MANAGER_ID || !review.approvalId) fail('Approval identity mismatch', 403);
      return transaction(async tx => {
        const auditRef = db.collection(AUDIT).doc(review.approvalId);
        const audit = data(await tx.get(auditRef));
        if (!audit || audit.employeeId !== MANAGER_ID || audit.approvedBy !== identity.uid || !audit.approvedAt || !audit.reason || audit.month !== review.month || audit.fingerprint !== review.fingerprint || !['approved', 'applied'].includes(audit.state)) fail('Authorized approval audit required', 403);
        const current = await reconcileMonth(tx, db, review.month, timestamp);
        if (current.fingerprint !== audit.fingerprint || current.proposal.review.length) fail('Attendance or leave changed; regenerate preview');
        const byDate = new Map(current.records.map(r => [r.date, r]));
        let created = 0;
        for (const day of current.proposal.days.filter(d => d.eligible)) {
          const prior = byDate.get(day.date);
          if (prior) {
            if (!matchesAudit(prior, audit, review.approvalId)) fail('Existing estimate belongs to another approval or has inconsistent metadata');
            continue;
          }
          if (audit.state === 'applied') fail('Applied history is incomplete; administrator investigation required');
          tx.create(db.collection(HISTORY).doc(id(day.date)), {
            employeeId: MANAGER_ID, date: day.date, attendanceStatus: day.status === 'Absent (Proposed)' ? 'Absent' : 'Present',
            estimated: true, source: 'admin_approved_historical_estimate', clockInVerified: false, clockIn: null, clockOut: null, breaks: null,
            approvedBy: audit.approvedBy, approvedAt: audit.approvedAt, reason: 'Manager historical attendance estimate', reviewReason: audit.reason, approvalId: review.approvalId,
          });
          created++;
        }
        if (audit.state !== 'applied') tx.update(auditRef, { state: 'applied', appliedAt: stamp(), count: current.proposal.days.filter(d => d.eligible).length });
        return { month: review.month, created, alreadyApplied: audit.state === 'applied' };
      });
    },
    async history(identity, month, { dailyOnly = false, date = null } = {}) {
      managerIdentity(identity);
      const { start, end } = monthBounds(month);
      if (date && (!dailyOnly || !validDate(date) || date < start || date > end)) fail('Invalid daily history date', 400);
      const dates = date ? [date] : daysBetween(start, end);
      const records = [];
      for (const date of dates) {
        for (const name of dailyOnly ? [DAILY] : [HISTORY, DAILY]) {
          const snap = await direct.get(db.collection(name).doc(id(date)));
          if (snap.exists) { const row = snap.data(); assertOwner(row); if (row.date !== date) fail('Stored date does not match document ID'); records.push({ ...row, id: snap.id }); }
        }
      }
      if (dailyOnly) return { month, records, days: dates.map(date => ({ date, weeklyOff: [0, 6].includes(new Date(date).getUTCDay()) })) };
      const seen = new Set();
      for (const name of ['attendance', 'attendanceDaily']) for (const field of ['employeeId', 'empId']) {
        const snapshot = await db.collection(name).where(field, '==', MANAGER_ID).where('date', '>=', start).where('date', '<=', end).limit(QUERY_CAP + 1).get();
        if (snapshot.docs.length > QUERY_CAP) fail('Monthly legacy history limit exceeded; manual review required');
        for (const snap of snapshot.docs) {
          const path = `${name}/${snap.id}`;
          if (seen.has(path)) continue;
          seen.add(path);
          const row = snap.data(); assertOwner(row);
          records.push({ employeeId: MANAGER_ID, date: normalizedDate(row.date), id: path, legacy: true, estimated: false, clockInVerified: false, attendanceStatus: row.status || row.attendanceStatus || row.action || 'Existing', source: 'legacy_attendance_verification_unknown' });
        }
      }
      return { month, records, days: daysBetween(start, end).map(date => ({ date, weeklyOff: [0, 6].includes(new Date(date).getUTCDay()) })) };
    },
    async verify(identity, review) {
      managerIdentity(identity);
      if (review.uid !== identity.uid || review.employeeId !== MANAGER_ID || !review.approvalId) fail('Approval identity mismatch', 403);
      const audit = data(await direct.get(db.collection(AUDIT).doc(review.approvalId)));
      if (!audit || audit.approvedBy !== identity.uid || audit.fingerprint !== review.fingerprint || audit.employeeId !== MANAGER_ID || audit.month !== review.month) fail('Approval audit required', 403);
      const current = await reconcileMonth(direct, db, review.month, timestamp);
      const expected = current.proposal.days.filter(d => d.eligible).length;
      const count = current.records.filter(r => matchesAudit(r, audit, review.approvalId)).length;
      return { month: review.month, count, expected, verified: audit.state === 'applied' && audit.count === expected && count === expected && current.fingerprint === audit.fingerprint && current.proposal.review.length === 0 };
    },
    async daily(identity, action, breakType, now = new Date(), command) {
      managerIdentity(identity);
      const today = dateInIndia(now);
      if (today <= HISTORY_END) fail('Daily tracking begins after 13 November 2026');
      const stateRef = db.collection('managerAttendanceState').doc(MANAGER_ID);
      function stateVersion(state) {
        if (!state) return 0;
        assertOwner(state);
        if (!Number.isSafeInteger(state.version) || state.version < 0) fail('Manager state requires version reconciliation');
        return state.version;
      }
      if (!action) {
        const state = data(await direct.get(stateRef));
        const version = stateVersion(state);
        const date = state?.activeDate || today;
        if (!validDate(date) || date > today || date <= HISTORY_END) fail('Invalid active shift date');
        const record = data(await direct.get(db.collection(DAILY).doc(id(date))));
        if (record) assertOwner(record);
        if (state?.activeDate && (!record || record.version !== version || record.state === 'ended')) fail('Active shift state requires reconciliation');
        return { date, shiftId: id(date), version, today, record };
      }
      if (!command || !/^[A-Za-z0-9_-]{16,64}$/.test(command.key || '') || !validDate(command.date) || command.date <= HISTORY_END || command.date > today || command.shiftId !== id(command.date) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) fail('Expected shift, state version and bounded command key required', 400);
      const fingerprint = digest([identity.uid, action, breakType || null, command.date, command.expectedVersion]);
      return transaction(async tx => {
        const state = data(await tx.get(stateRef));
        const version = stateVersion(state);
        const date = state?.activeDate || today;
        const target = db.collection(DAILY).doc(command.shiftId);
        const prior = data(await tx.get(target));
        if (prior) assertOwner(prior);
        const receipt = prior?.commands?.[command.key];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail('Command key already used for a different operation');
          return { date: command.date, state: receipt.state, version: receipt.version, replayed: true };
        }
        if (date !== command.date || command.expectedVersion !== version) fail('Stale shift command; recover daily state and review before retrying');
        if (state?.activeDate && !prior) fail('Active shift record missing; administrator review required');
        if (prior && prior.version !== version) fail('Shift version requires reconciliation');
        if (Object.keys(prior?.commands || {}).length >= 32) fail('Daily command receipt limit reached');
        // An unclosed shift stays attached to its original date across midnight.
        const next = dailyTransition(prior, action, breakType, stamp(), date);
        next.version = version + 1;
        next.commands = { ...prior?.commands, [command.key]: { fingerprint, state: next.state, version: next.version } };
        if (prior) tx.update(target, next); else tx.create(target, next);
        tx.set(stateRef, { employeeId: MANAGER_ID, activeDate: next.state === 'ended' ? null : date, version: next.version });
        return { date, state: next.state, version: next.version, replayed: false };
      });
    },
  };
}
