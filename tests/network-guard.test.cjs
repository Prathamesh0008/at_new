require('./no-live-network.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
test('offline guard rejects fetch, HTTP, HTTPS and socket connection attempts before IO', async () => {
  await assert.rejects(fetch('https://example.invalid'), { code: 'OFFLINE_TEST_NETWORK_FORBIDDEN' });
  for (const name of ['node:http', 'node:https']) assert.throws(() => require(name).request('https://example.invalid'), { code: 'OFFLINE_TEST_NETWORK_FORBIDDEN' });
  assert.throws(() => require('node:net').createConnection(1), { code: 'OFFLINE_TEST_NETWORK_FORBIDDEN' });
  assert.throws(() => require('node:tls').connect(1), { code: 'OFFLINE_TEST_NETWORK_FORBIDDEN' });
});
