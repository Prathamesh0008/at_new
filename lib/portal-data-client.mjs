import { encode, decode, Timestamp } from './portal-wire.mjs';
export { Timestamp };
let identityEpoch = 0;
export const invalidatePortalTransport = () => { identityEpoch++; };
export const db = Object.freeze({ type: 'protected-portal' });
export const collection = (_db, name) => ({ type: 'collection', name, epoch: identityEpoch, constraints: [] });
export const doc = (_db, name, id) => ({ type: 'document', name, id, epoch: identityEpoch });
export const query = (ref, ...constraints) => ({ ...ref, type: 'query', constraints: [...(ref.constraints || []), ...constraints] });
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({ kind: 'order', field, direction });
export const limit = count => ({ kind: 'limit', count });
export const startAfter = snapshot => ({ kind: 'cursor', id: snapshot.id });
export const serverTimestamp = () => ({ $serverTimestamp: true });
export const queryEqual = (a, b) => JSON.stringify(encode(a)) === JSON.stringify(encode(b));
export const refEqual = queryEqual;
const snapshot = row => ({ id: row.id, exists: () => row.data !== null, data: () => decode(row.data) });
export async function portalRequest(body, fetcher = fetch) {
  const captured = identityEpoch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher('/api/portal-data', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(encode(body)) });
    const result = await response.json();
    if (captured !== identityEpoch) throw Object.assign(new Error('Session changed; refresh data'), { code: 'SESSION_CHANGED' });
    if (!response.ok) throw Object.assign(new Error(result.error || 'Portal data request failed'), { code: result.code || `HTTP_${response.status}` });
    return result;
  } catch (error) { throw Object.assign(error, { code: error.code || 'PORTAL_TRANSPORT_FAILURE' }); }
  finally { clearTimeout(timer); }
}
export async function getDocs(ref) {
  const docs = []; let cursor;
  const explicitLimit = [...(ref.constraints || [])].reverse().find(c => c.kind === 'limit')?.count;
  do {
    const result = await portalRequest({ operation: 'list', ref, cursor });
    docs.push(...result.rows.map(snapshot)); cursor = result.nextCursor;
    if (explicitLimit && docs.length >= explicitLimit) break;
  } while (cursor);
  return { docs, size: docs.length, empty: !docs.length, forEach: callback => docs.forEach(callback) };
}
export const getDoc = async ref => snapshot(await portalRequest({ operation: 'get', ref }));
export const addDoc = (ref, data) => portalRequest({ operation: 'add', ref, data });
export const updateDoc = (ref, data) => portalRequest({ operation: 'update', ref, data });
export const setDoc = (ref, data, options) => portalRequest({ operation: 'set', ref, data, options });
