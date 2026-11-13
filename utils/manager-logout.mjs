let generation = 0, signingOut = 0, sessionChange = Promise.resolve();
function serialize(operation) {
  const pending = sessionChange.then(operation);
  sessionChange = pending.catch(() => {});
  return pending;
}
export function managerSignInAttempt() {
  if (signingOut) throw new Error('Manager sign-out is in progress. Wait before signing in again.');
  return generation;
}
export function exchangeManagerBrowserSession(attempt, operation) {
  return serialize(async () => {
    if (attempt !== generation || signingOut) throw new Error('Manager sign-in cancelled by sign-out');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try { return await operation(controller.signal); }
    finally { clearTimeout(timer); }
  });
}
// Cookie deletion only: this endpoint requires neither Firebase nor activation.
// Wait for an earlier same-tab cookie exchange so it cannot recreate the session
// after a successful logout. Invalidate sign-in attempts still waiting on Auth.
export async function clearManagerBrowserSession(fetcher = fetch) {
  generation++;
  signingOut++;
  try { return await serialize(() => clearCookie(fetcher)); }
  finally { signingOut--; }
}
async function clearCookie(fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher('/api/manager-attendance/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Manager sign-out could not be confirmed. Retry Logout before leaving this browser.');
  } catch {
    throw new Error('Manager sign-out could not be confirmed. Retry Logout before leaving this browser.');
  } finally { clearTimeout(timer); }
}
