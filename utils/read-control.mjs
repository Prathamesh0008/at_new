export const isQuotaError = error => error?.code === 8 || error?.code === 'resource-exhausted' || String(error?.code || '').includes('QUOTA_EXCEEDED');
export const readDiagnosticsEnabled = () => process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS === 'true';
export function readDiagnostic(event, fields = {}) {
  if (!readDiagnosticsEnabled()) return;
  const safe = {};
  for (const key of ['site', 'documents', 'requests', 'intervalMs', 'active', 'duplicate']) if (fields[key] !== undefined) safe[key] = fields[key];
  console.info('[firestore-read]', event, safe);
}
export function createReadCoordinator() {
  let blocked = false;
  const pending = [];
  return {
    isBlocked: () => blocked,
    block: () => { blocked = true; },
    run(ref, operation, equal = (a, b) => a === b, site = 'read') {
      if (blocked) return Promise.reject(Object.assign(new Error('Firestore quota exhausted; automatic reads paused. Reload after the quota is restored.'), { code: 'resource-exhausted' }));
      const existing = pending.find(entry => equal(entry.ref, ref));
      if (existing) { readDiagnostic('deduplicated', { site }); return existing.promise; }
      const entry = { ref };
      entry.promise = Promise.resolve().then(() => {
        // A quota response can arrive after enqueueing but before this starts.
        if (blocked) throw Object.assign(new Error('Firestore quota exhausted; queued read cancelled.'), { code: 'resource-exhausted' });
        return operation();
      }).then(result => {
        readDiagnostic('logical-read-completed', { site, requests: 1 });
        return result;
      }).catch(error => { if (isQuotaError(error)) blocked = true; throw error; })
        .finally(() => { pending.splice(pending.indexOf(entry), 1); });
      pending.push(entry);
      return entry.promise;
    },
  };
}
// One operation at a time; hidden tabs pause and cleanup prevents rescheduling.
const activePolls = new Map();
export function startReadPolling(task, intervalMs, { site = 'read-poll', blocked = () => false, visible = () => typeof document === 'undefined' || !document.hidden, immediate = true, onError = () => {} } = {}) {
  let stopped = false, timer;
  const tick = async () => {
    if (stopped || blocked()) return;
    try { if (visible()) await task(); }
    catch (error) { onError(error); if (isQuotaError(error)) stopped = true; }
    if (!stopped && !blocked()) timer = setTimeout(tick, intervalMs);
  };
  const active=(activePolls.get(site) || 0)+1; activePolls.set(site,active);
  readDiagnostic('poll-start', { site, intervalMs, active, duplicate:active>1 });
  if (immediate) void tick(); else timer = setTimeout(tick, intervalMs);
  let cleaned=false;
  return () => { stopped = true; clearTimeout(timer); if(!cleaned){cleaned=true;activePolls.set(site,Math.max(0,(activePolls.get(site)||1)-1));readDiagnostic('poll-stop', {site,intervalMs,active:activePolls.get(site)});} };
}

export const clientReadCoordinator = createReadCoordinator();
