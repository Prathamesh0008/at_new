import { managerSignInAttempt, exchangeManagerBrowserSession } from '../utils/manager-logout.mjs';

// Manager-only credential exchange; the server fixes the identity, never the browser.
export async function establishManagerSession(password, { fetcher = fetch } = {}) {
  const attempt = managerSignInAttempt();
  await exchangeManagerBrowserSession(attempt, async signal => {
    const result = await fetcher('/api/manager-attendance/session', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const session = await result.json();
    if (!result.ok || session.authenticated !== true || session.employeeId !== 'NTS-MGR') {
      // The route returns only fixed, sanitized service/authentication errors.
      throw new Error(session.error || 'Manager session could not be established. Contact the administrator.');
    }
  });
}
