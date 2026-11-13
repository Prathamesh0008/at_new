// No polling; recover on mount, explicit refresh and committed commands only.
export function createEmployeeDailyClient({ fetcher = fetch, key = () => crypto.randomUUID(), expectedEmployeeId } = {}) {
  let snapshot = null, pending = null, flight = null, paused = '', recovery = null;
  const request = async (path, body) => {
    if (paused) throw new Error(paused);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!response.ok) { if (/QUOTA|resource-exhausted/.test(value.code || '') || /quota/i.test(value.error || '')) paused = 'Attendance reads paused after quota exhaustion; retry after quota recovery.'; if ([401,403].includes(response.status)) paused = 'Attendance authorization failed; sign in again.'; throw Object.assign(new Error(value.error || 'Attendance request failed'), { code: value.code }); }
      if (expectedEmployeeId && (value.state?.employeeId !== expectedEmployeeId || value.shiftId !== `${expectedEmployeeId}_${value.date}` || !Number.isSafeInteger(value.version))) throw new Error('Attendance session changed; sign in and refresh state.');
      return value;
    } finally { clearTimeout(timer); }
  };
  return {
    async recover() {
      if (flight) return flight;
      if (recovery) return recovery;
      recovery = request('/api/attendance').then(value => { snapshot = value; pending = null; return value; }).finally(() => { recovery = null; });
      return recovery;
    },
    async perform(path, body) {
      const inFlight = () => {
        if (pending?.path === path && pending.body.action === body.action && pending.body.breakType === body.breakType) return flight;
        throw new Error('Wait for the pending attendance command');
      };
      if (flight) return inFlight();
      if (recovery) await recovery;
      if (flight) return inFlight();
      if (!snapshot) throw new Error('Refresh attendance state before continuing');
      if (pending && (pending.path !== path || pending.body.action !== body.action || pending.body.breakType !== body.breakType)) throw new Error('Recover the pending attendance command first');
      pending ||= { path, body: { action: body.action, ...(body.breakType ? { breakType: body.breakType } : {}), command: { key: key(), date: snapshot.date, shiftId: snapshot.shiftId, expectedVersion: snapshot.version } } };
      flight = request(path, pending.body).then(value => { snapshot = value; pending = null; return value; }).finally(() => { flight = null; });
      return flight;
    },
  };
}
