import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withLoginDeadline } from '../lib/server/login-deadline.mjs';
import { loginSession, SESSION_REQUEST_TIMEOUT_MS } from '../utils/sessionClient.mjs';

test('server login dependency timeout returns safe 503 and observes late rejection', async () => {
  let rejectPending;
  const pending = new Promise((_, reject) => { rejectPending = reject; });
  await assert.rejects(withLoginDeadline(pending, 5), error => error.status === 503 && error.message.includes('timed out'));
  rejectPending(new Error('late SDK rejection'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await withLoginDeadline(Promise.resolve('ready'), 20), 'ready');
});

test('a hung login times out, aborts, and releases the submission lock', async context => {
  const original = globalThis.fetch;
  let signal;
  globalThis.fetch = async (_url, options) => { signal = options.signal; return new Promise(() => {}); };
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = loginSession('NTS-MGR', 'invalid-test-input');
    context.mock.timers.tick(SESSION_REQUEST_TIMEOUT_MS + 1);
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.message, /timed out/);
    assert.ok(signal.aborted);
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'Controlled retry response' }) });
    assert.equal((await loginSession('NTS-MGR', 'invalid-test-input')).message, 'Controlled retry response');
  } finally { globalThis.fetch = original; context.mock.timers.reset(); }
});
