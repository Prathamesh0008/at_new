// One in-flight request per operation; failures never trigger automatic retries.
let sessionRead = null;
let sessionLogin = null;
export const SESSION_REQUEST_TIMEOUT_MS = 15000;
async function requestSession(options) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Sign-in timed out. Please try again later or contact the administrator.'));
      controller.abort();
    }, SESSION_REQUEST_TIMEOUT_MS);
  });
  const request = async () => {
    const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) return { success: false, message: data.message || data.error || 'Sign-in unavailable' };
    return data;
  };
  try { return await Promise.race([request(), timeout]); }
  finally { clearTimeout(timer); }
}

export function readSession() {
  if (!sessionRead) sessionRead = requestSession().finally(() => { sessionRead = null; });
  return sessionRead;
}
export function loginSession(employeeId, password) {
  if (!sessionLogin) {
    sessionLogin = requestSession({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, password }),
    }).catch(error => ({ success: false, message: error.message?.startsWith('Sign-in timed out.') ? error.message : 'Sign-in unavailable. Please try again later.' }))
      .finally(() => { sessionLogin = null; });
  }
  return sessionLogin;
}

export const deleteSession = async () => { if (sessionLogin) await sessionLogin; return requestSession({ method: 'DELETE' }); };
