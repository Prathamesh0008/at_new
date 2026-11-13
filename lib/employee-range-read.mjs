const DAY = 86400000;
const MAX_ROWS = 1000;
// Recover an employee range read from an unavailable composite query without
// scanning a collection or retrying permission/quota failures. Manager queries
// and history reconciliation are deliberately excluded.
export function createEmployeeRangeReader({ now = Date.now } = {}) {
  const fallbackUntil = new Map();
  return async (name, scope, indexedRead, rangeRead) => {
    const start = Date.parse(scope.start), end = Date.parse(scope.end);
    const eligible = !!scope.employeeId && scope.employeeId !== 'NTS-MGR' && Number.isFinite(start) && Number.isFinite(end) && start <= end;
    if (!eligible) return indexedRead();
    if ((fallbackUntil.get(name) || 0) <= now()) {
      try { return await indexedRead(); }
      catch (error) {
        if (error.code !== 'failed-precondition' && error.code !== 9) throw error;
        fallbackUntil.set(name, now() + 300000);
      }
    }
    const docs = new Map();
    // At most 31 days and 1,001 documents per fallback query. The coordinator
    // caches/deduplicates identical windows across overlapping portal requests.
    for (let from = start; from <= end; from += 31 * DAY) {
      const snapshot = await rangeRead(new Date(from), new Date(Math.min(end, from + 31 * DAY - 1)), MAX_ROWS + 1);
      if (snapshot.docs.length > MAX_ROWS) throw Object.assign(new Error('Attendance range exceeds the fallback read limit; a composite index or narrower range is required'), { code: 'EMPLOYEE_RANGE_LIMIT' });
      for (const doc of snapshot.docs) {
        const row = doc.data();
        if ((row.employeeId === scope.employeeId || row.empId === scope.employeeId) && (!row.employeeId || row.employeeId === scope.employeeId) && (!row.empId || row.empId === scope.employeeId)) docs.set(doc.id, doc);
      }
    }
    const timestamp = doc => { const value = doc.data().timestamp; return +new Date(typeof value?.toDate === 'function' ? value.toDate() : value) || 0; };
    return [{ docs: [...docs.values()].sort((a, b) => timestamp(b) - timestamp(a)) }];
  };
}
