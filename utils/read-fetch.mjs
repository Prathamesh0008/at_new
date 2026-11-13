import { clientReadCoordinator, isQuotaError } from './read-control.mjs';
export const readJson = (url, scope) => clientReadCoordinator.run(`${scope}:${url}`, async () => {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    const error = Object.assign(new Error(data.error || 'Read unavailable'), { code: data.code });
    if (isQuotaError(error)) clientReadCoordinator.block();
    throw error;
  }
  return data;
}, undefined, 'attendance-api');
