export const REFRESH_ERROR = 'Could not refresh portal data';
export function refreshFailure(jobs, results) {
  const failed = results.map((result, index) => ({ ...result, section: jobs[index].section }))
    .filter(result => result.status === 'rejected' && result.reason?.code !== 'READ_PAUSED');
  if (!failed.length) return null;
  const safe = code => ['failed-precondition', 'permission-denied', 'resource-exhausted', 'unavailable', 'unauthenticated', 'EMPLOYEE_RANGE_LIMIT'].includes(code) ? code : 'load-error';
  return `${REFRESH_ERROR} (${failed.map(result => `${result.section}: ${safe(result.reason?.code)}`).join('; ')}). Use Refresh to retry.`;
}
export const clearRefreshFailure = previous => previous.startsWith(REFRESH_ERROR) ? '' : previous;
