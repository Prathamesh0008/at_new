// Mandatory preloader for the offline audit test command; never permits network IO.
const forbidden = () => {
  throw Object.assign(new Error('Network disabled for offline tests'), { code: 'OFFLINE_TEST_NETWORK_FORBIDDEN' });
};
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = forbidden;
  transport.get = forbidden;
}
const net = require('node:net');
net.connect = forbidden;
net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden;
require('node:tls').connect = forbidden;
globalThis.fetch = async () => forbidden();
