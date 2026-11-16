const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const statusPath = 'security-audit/manager-local-activation-result.json';
const writeStatus = value => fs.writeFileSync(statusPath, JSON.stringify(value, null, 2) + '\n');
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { password } = JSON.parse(input); input = '';
  if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password) > 1024) throw Error('Use a new password of at least 16 characters');
  const legacy = JSON.parse(fs.readFileSync('lib/server/legacy-password-hashes.json'))['NTS-MGR'];
  if (!legacy || crypto.timingSafeEqual(crypto.scryptSync(password, 'NTS-MGR', 64), Buffer.from(legacy, 'hex'))) throw Error('Exposed legacy credential refused');
  const proof = JSON.parse(fs.readFileSync('security-audit/manager-rules-deployment-result.json'));
  const sha = crypto.createHash('sha256').update(fs.readFileSync('firestore.rules')).digest('hex');
  if (!proof.verified || !proof.readbackMatches || proof.projectId !== 'nova-attendance-1bf55' || proof.candidateSha256 !== sha) throw Error('Verified storage protection required');
  require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  if (Buffer.byteLength(process.env.MANAGER_ATTENDANCE_SESSION_SECRET || '') < 32 || process.env.MANAGER_ATTENDANCE_ORIGIN !== 'http://localhost:3000') throw Error('Existing session secret or local origin requires review');
  const salt = crypto.randomBytes(32);
  const verifier = JSON.stringify({ algorithm: 'scrypt-v1', salt: salt.toString('hex'), hash: crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 33554432 }).toString('hex') });
  const filename = path.resolve('.env.local');
  let content = fs.readFileSync(filename, 'utf8');
  const settings = { MANAGER_ATTENDANCE_PASSWORD_VERIFIER: `'${verifier}'`, MANAGER_ATTENDANCE_STORAGE_APPROVED: 'true', MANAGER_ATTENDANCE_ENABLED: 'true', MANAGER_ATTENDANCE_APPLY_ENABLED: 'false' };
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    content = pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : content + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(filename, content);
  writeStatus({ credentialConfigured: true, authenticationReady: false, attendancePersistence: 'NOT TESTED' });
  console.log('Private verifier configured. Waiting for the authorized local server check.');
  const deadline = Date.now() + 600000;
  while (!fs.existsSync('security-audit/manager-local-server-ready.json')) {
    if (Date.now() > deadline) throw Error('Local server readiness confirmation timed out');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const origin = 'http://localhost:3000';
  const response = await fetch(origin + '/api/manager-attendance/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(120000) });
  if (response.status !== 200) throw Error(`Protected manager login returned HTTP ${response.status}`);
  const cookie = response.headers.get('set-cookie');
  if (!cookie?.includes('HttpOnly') || !cookie.includes('SameSite=Strict') || !cookie.includes('Path=/api/manager-attendance')) throw Error('Session cookie protection check failed');
  const headers = { Cookie: cookie.split(';')[0] };
  const session = await fetch(origin + '/api/manager-attendance/session', { headers });
  const identity = await session.json();
  if (session.status !== 200 || identity.authenticated !== true || identity.employeeId !== 'NTS-MGR' || identity.applyEnabled) throw Error('Session identity validation failed');
  for (let i = 0; i < 2; i++) {
    const daily = await fetch(origin + '/api/manager-attendance/daily', { headers });
    if (daily.status !== 200) throw Error(`Daily state recovery returned HTTP ${daily.status}`);
  }
  const logout = await fetch(origin + '/api/manager-attendance/session', { method: 'DELETE', headers: { ...headers, Origin: origin } });
  if (logout.status !== 200) throw Error('Diagnostic session logout failed');
  writeStatus({ credentialConfigured: true, authenticationReady: true, dailyReadRecovery: true, historicalApplyEnabled: false, attendancePersistence: 'NOT TESTED', checkedAt: new Date().toISOString() });
  console.log('Protected authentication and daily state recovery verified. No attendance event created.');
}
main().catch(error => {
  const safe = ['Use a new password of at least 16 characters', 'Exposed legacy credential refused', 'Verified storage protection required', 'Existing session secret or local origin requires review', 'Local server readiness confirmation timed out', 'Session cookie protection check failed', 'Session identity validation failed', 'Diagnostic session logout failed'];
  const reason = safe.includes(error.message) || /^Protected manager login returned HTTP \d+$/.test(error.message) || /^Daily state recovery returned HTTP \d+$/.test(error.message) ? error.message : 'Secure setup failed without exposing diagnostic secrets';
  writeStatus({ credentialConfigured: false, authenticationReady: false, failure: reason, attendancePersistence: 'NOT TESTED' });
  console.error(reason); process.exitCode = 1;
});
