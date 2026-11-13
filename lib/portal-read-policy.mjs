export const NOTIFICATION_INTERVAL_MS = 60000;
export const BREAK_INTERVAL_MS = 30000;
export const PORTAL_CACHE_MS = 300000;
export const isQuotaFailure = error => error?.code === 8 || /resource-exhausted|QUOTA_EXCEEDED/.test(String(error?.code || ''));
const paused = () => Object.assign(new Error('Firestore quota exhausted. Reads are paused; reload only after quota is restored.'), { code: 'resource-exhausted' });

export function createPortalReads({ now = Date.now, visible = () => typeof document === 'undefined' || !document.hidden } = {}) {
  let generation = 0, blocked = false;
  const cache = [], pending = [];
  return {
    isBlocked: () => blocked,
    invalidate() { generation++; cache.length = 0; },
    async run(key, read, equal = (a, b) => a === b, maxAge = PORTAL_CACHE_MS) {
      if (blocked) throw paused();
      const prior = pending.find(entry => equal(entry.key, key));
      if (prior) {
        if (prior.generation === generation) return prior.promise;
        // A mutation invalidated an in-flight read: wait, then read the new state.
        await prior.promise;
        return this.run(key, read, equal, maxAge);
      }
      const hit = cache.find(entry => equal(entry.key, key) && now() - entry.at < maxAge);
      if (hit) return hit.value;
      if (!visible()) throw Object.assign(new Error('Reads paused while this tab is hidden'), { code: 'READ_PAUSED' });
      const entry = { key, generation };
      entry.promise = Promise.resolve().then(() => {
        if (blocked) throw paused();
        if (!visible()) throw Object.assign(new Error('Reads paused while this tab is hidden'), { code: 'READ_PAUSED' });
        return read();
      }).then(value => {
        if (entry.generation === generation) {
          const old = cache.findIndex(item => equal(item.key, key));
          if (old >= 0) cache.splice(old, 1);
          cache.push({ key, value, at: now() });
          if (cache.length > 64) cache.shift();
        }
        return value;
      }).catch(error => { if (isQuotaFailure(error)) blocked = true; throw error; })
        .finally(() => { pending.splice(pending.indexOf(entry), 1); });
      pending.push(entry);
      return entry.promise;
    },
  };
}

export const portalReads = createPortalReads();

// Timer is scheduled only after work finishes. No overlapping cycles or hidden reads.
export function pollVisible(task, intervalMs, { visible = () => !document.hidden, blocked = () => portalReads.isBlocked(), onError = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let stopped = false, timer;
  const tick = async () => {
    if (stopped || blocked()) return;
    try { if (visible()) await task(); }
    catch (error) { onError(error); if (isQuotaFailure(error)) stopped = true; }
    if (!stopped && !blocked()) timer = schedule(tick, intervalMs);
  };
  void tick();
  return () => { stopped = true; cancel(timer); };
}

export function portalDataPlan(_role, tab) {
  return {
    // Shared sidebar calendar and employee task locks remain available on every tab.
    leaves: true, tasks: true, settings: true,
    worksheets: ['dashboard', 'worksheets', 'exports'].includes(tab),
    salary: ['salary', 'exports'].includes(tab),
    attendance: ['dashboard', 'salary', 'exports'].includes(tab),
    breaks: ['dashboard', 'exports'].includes(tab),
    allHistory: tab === 'exports',
  };
}

export function mergeDateWindows(windows) {
  const sorted = windows.map(({ start, end }) => ({ start: +start, end: +end })).filter(window => Number.isFinite(window.start) && Number.isFinite(window.end) && window.start <= window.end).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && window.start <= last.end + 1) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged.map(({ start, end }) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
}
