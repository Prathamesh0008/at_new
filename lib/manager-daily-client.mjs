import { MANAGER_ID, BREAK_TYPES, validDate } from './manager-domain.mjs';

const BLOCKER = 'Manager controls require a server-verified manager session. Sign in through the portal with the private manager credential.';
const INITIAL = { ready: false, busy: false, error: '', snapshot: null, records: [], pending: null, paused: false };
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T');
export function verifiedDailyRecord(row) {
  return row?.employeeId === MANAGER_ID && row.source === 'verified_manager_daily' && row.estimated === false && row.clockInVerified === true && validDate(row.date) && iso(row.clockIn) && (!row.clockOut || (iso(row.clockOut) && Date.parse(row.clockOut) >= Date.parse(row.clockIn)));
}

// Presentation adapters for real server records only. No writes or synthetic times.
export function managerDailyEvents(records, name = 'Manager') {
  return records.filter(verifiedDailyRecord).flatMap(row => [
    { time: row.clockIn, action: 'clock-in' }, ...(row.clockOut ? [{ time: row.clockOut, action: 'clock-out' }] : []),
  ].map(event => ({ id: `${MANAGER_ID}_${row.date}_${event.action}`, empId: MANAGER_ID, employeeId: MANAGER_ID, empName: name, employeeName: name, date: row.date, action: event.action, timestamp: new Date(event.time), time: new Date(event.time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }), clockIn: row.clockIn, clockOut: row.clockOut, estimated: false, clockInVerified: true, source: row.source })));
}

export function mergeManagerDailyEvents(legacy, records, name) {
  const dates = new Set(records.filter(verifiedDailyRecord).map(row => row.date));
  return [...legacy.filter(row => (row.employeeId || row.empId) !== MANAGER_ID || !dates.has(row.date)), ...managerDailyEvents(records, name)];
}

export function mergeManagerDailyBreaks(legacy, records, name = 'Manager') {
  const verified = records.filter(verifiedDailyRecord);
  const dates = new Set(verified.map(row => row.date));
  const actual = verified.flatMap(row => Object.entries(row.breaks || {}).filter(([type, entry]) => BREAK_TYPES.includes(type) && iso(entry.start)).flatMap(([type, entry]) => [
    { time: entry.start, action: 'start' }, ...(entry.end && iso(entry.end) ? [{ time: entry.end, action: 'end' }] : []),
  ].map(event => ({ id: `${MANAGER_ID}_${row.date}_${type}_${event.action}`, employeeId: MANAGER_ID, employeeName: name, date: row.date, breakType: type, action: event.action, status: event.action === 'start' ? 'Active' : 'Completed', timestamp: new Date(event.time), source: row.source }))));
  return [...legacy.filter(row => (row.employeeId || row.empId) !== MANAGER_ID || !dates.has(row.date)), ...actual];
}

export function managerControlState(state) {
  const record = state.snapshot?.record;
  const working = !!record && record.state !== 'ended';
  const usable = state.ready && !!state.snapshot && !state.busy && !state.paused && !state.pending;
  return {
    shiftRunning: working,
    shiftStartAt: record ? Date.parse(record.clockIn) : null,
    activeBreakType: record?.activeBreak || '',
    breakStartAt: record?.activeBreak ? Date.parse(record.breaks[record.activeBreak].start) : null,
    canStart: usable && !record, canEnd: usable && working && !record.activeBreak,
    canBreak: type => usable && working && BREAK_TYPES.includes(type) && (record.activeBreak === type || (!record.activeBreak && !record.breaks[type])),
  };
}

export function createManagerDailyClient({ fetcher = fetch, newKey = () => crypto.randomUUID(), now = Date.now, blocked = () => false } = {}) {
  let state = INITIAL, epoch = 0, connectFlight = null, recoverFlight = null, mutationFlight = null;
  const listeners = new Set(), history = new Map(), historyFlights = new Map(), revisions = new Map();
  const emit = update => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
  function records(snapshot = state.snapshot) {
    const rows = new Map([...history.values()].flatMap(value => value.records).map(row => [row.date, row]));
    if (snapshot?.record) rows.set(snapshot.record.date, snapshot.record);
    return [...rows.values()];
  }
  async function request(path, body) {
    if (state.paused || blocked()) {
      emit({ paused: true, ready: false });
      throw new Error('Manager reads paused after quota exhaustion. Reload only after quota is restored.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(`/api/manager-attendance/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { history.clear(); emit({ ready: false, snapshot: null, records: [], pending: null }); }
        if (/quota/i.test(value.error || '')) emit({ paused: true, ready: false });
        throw new Error(value.error || 'Manager attendance request failed');
      }
      return value;
    } finally { clearTimeout(timer); }
  }
  function validate(snapshot) {
    if (!snapshot || !validDate(snapshot.date) || snapshot.shiftId !== `${MANAGER_ID}_${snapshot.date}` || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0) throw new Error('Invalid manager state; refresh before continuing');
    if (snapshot.record && (!verifiedDailyRecord(snapshot.record) || snapshot.record.date !== snapshot.date || !['working', 'break', 'ended'].includes(snapshot.record.state))) throw new Error('Invalid manager daily record; no timestamps inferred');
    if (snapshot.record && (!snapshot.record.breaks || typeof snapshot.record.breaks !== 'object')) throw new Error('Invalid manager break records');
    if (snapshot.record && snapshot.record.version !== snapshot.version) throw new Error('Manager state changed during recovery; use Refresh again');
    if (snapshot.record?.activeBreak && (!BREAK_TYPES.includes(snapshot.record.activeBreak) || !iso(snapshot.record.breaks?.[snapshot.record.activeBreak]?.start))) throw new Error('Invalid manager break state');
    return snapshot;
  }
  async function readDaily(captured = epoch) {
    if (recoverFlight?.epoch === captured) return recoverFlight.promise;
    const flight = { epoch: captured };
    flight.promise = request('daily').then(validate).then(snapshot => {
      if (captured === epoch) emit({ snapshot, ready: true, records: records(snapshot), pending: null, error: '' });
      return snapshot;
    }).finally(() => { if (recoverFlight === flight) recoverFlight = null; });
    recoverFlight = flight;
    return flight.promise;
  }
  const client = {
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL,
    clear() { epoch++; history.clear(); emit({ ...INITIAL, paused: state.paused }); },
    async connect() {
      if (state.paused) return false;
      if (connectFlight?.epoch === epoch) return connectFlight.promise;
      const flight = { epoch };
      emit({ busy: true, error: '' });
      flight.promise = (async () => {
        try {
          const session = await request('session');
          if (flight.epoch !== epoch) return false;
          if (session.authenticated !== true || session.employeeId !== MANAGER_ID) { emit({ ready: false, error: BLOCKER }); return false; }
          await readDaily(flight.epoch);
          return true;
        } catch (error) { if (flight.epoch === epoch) emit({ ready: false, error: error.message }); return false; }
        finally { if (connectFlight === flight) { connectFlight = null; emit({ busy: false }); } }
      })();
      connectFlight = flight;
      return flight.promise;
    },
    async recover() {
      if (mutationFlight) return mutationFlight.promise;
      history.forEach(value => { value.at = 0; });
      if (!state.ready) return client.connect();
      const captured = epoch;
      emit({ busy: true });
      try { await readDaily(captured); return true; }
      catch (error) { if (captured === epoch) emit({ ready: false, error: error.message }); return false; }
      finally { if (captured === epoch) emit({ busy: false }); }
    },
    async loadMonth(month) {
      if (mutationFlight) { try { await mutationFlight.promise; } catch { return; } return client.loadMonth(month); }
      if (!state.ready || state.paused || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
      const cached = history.get(month);
      if (cached?.complete && now() - cached.at < 300000) return;
      if (historyFlights.get(month)?.epoch === epoch) return historyFlights.get(month).promise;
      const flight = { epoch, revision: revisions.get(month) || 0 };
      flight.promise = request(`history?month=${encodeURIComponent(month)}&view=daily`).then(value => {
        if (flight.epoch !== epoch || flight.revision !== (revisions.get(month) || 0)) return;
        history.set(month, { at: now(), complete: true, records: value.records.filter(verifiedDailyRecord) });
        if (history.size > 12) history.delete(history.keys().next().value);
        emit({ records: records() });
      }).catch(error => { if (flight.epoch === epoch) emit({ error: error.message }); }).finally(() => { if (historyFlights.get(month) === flight) historyFlights.delete(month); });
      historyFlights.set(month, flight);
      return flight.promise;
    },
    async perform(action, breakType, retry = false) {
      if (mutationFlight) {
        if (mutationFlight.action === action && mutationFlight.breakType === breakType) return mutationFlight.promise;
        throw new Error('Wait for the pending manager command');
      }
      if ((!state.ready && !retry) || !state.snapshot || state.paused) throw new Error(state.error || BLOCKER);
      if (state.pending && !retry) throw new Error('Recover state or retry the pending command first');
      const pending = retry ? state.pending : { action, ...(breakType ? { breakType } : {}), command: { key: newKey(), date: state.snapshot.date, shiftId: state.snapshot.shiftId, expectedVersion: state.snapshot.version } };
      if (!pending) throw new Error('No manager command to retry');
      const month = pending.command.date.slice(0, 7);
      revisions.set(month, (revisions.get(month) || 0) + 1);
      const flight = { action, breakType, epoch };
      emit({ busy: true, pending, error: '' });
      flight.promise = (async () => {
        try {
          await request('daily', pending);
          if (flight.epoch !== epoch) return;
          // Recover the actual committed timestamps; never derive them from the POST response.
          const snapshot = await readDaily(flight.epoch);
          if (flight.epoch !== epoch) return;
          let record = snapshot.record?.date === pending.command.date ? snapshot.record : null;
          // Closing an overnight shift clears the active pointer. Fetch that
          // exact original document so its real clock-out is not lost.
          if (!record) {
            const result = await request(`history?month=${month}&view=daily&date=${pending.command.date}`);
            record = result.records.find(row => row.date === pending.command.date && verifiedDailyRecord(row));
            if (!record) throw new Error('Committed shift record needs verification');
          }
          if (flight.epoch !== epoch) return;
          const prior = history.get(month);
          history.set(month, { at: prior?.at || now(), complete: prior?.complete || false, records: [...(prior?.records || []).filter(row => row.date !== record.date), record] });
          emit({ records: records(), pending: null });
        } catch (error) { if (flight.epoch === epoch) emit({ pending: state.snapshot ? pending : null, error: `${error.message}. Use Refresh to recover, or retry the same pending action.` }); throw error; }
        finally { if (mutationFlight === flight) { mutationFlight = null; if (flight.epoch === epoch) emit({ busy: false }); } }
      })();
      mutationFlight = flight;
      return flight.promise;
    },
    retry() { return client.perform(state.pending?.action, state.pending?.breakType, true); },
  };
  return client;
}
