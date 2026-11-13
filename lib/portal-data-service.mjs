import { COLLECTIONS, ownerFields, canRead, authorizeWrite, manager, deny } from './portal-policy.mjs';
import { encode } from './portal-wire.mjs';
export function parseValue(value, stamp, depth = 0) {
  if (depth > 16) deny('Payload too deeply nested', 400);
  if (Array.isArray(value)) return value.map(v => parseValue(v, stamp, depth + 1));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && value.$date) { const date = new Date(value.$date); if (Number.isNaN(+date)) deny('Invalid date', 400); return date; }
    if (Object.keys(value).length === 1 && value.$serverTimestamp === true) return stamp();
    if (Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key) || key.startsWith('$'))) deny('Invalid data', 400);
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, parseValue(v, stamp, depth + 1)]));
  }
  return value;
}
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/') && !['.', '..'].includes(id);
export function createPortalDataService({ db, Filter, stamp }) {
  return async (user, body) => {
    if (!user?.id) deny('Authentication required', 401);
    const { operation, ref } = body;
    if (!ref || !COLLECTIONS.includes(ref.name) || !['list', 'get', 'add', 'set', 'update'].includes(operation)) deny();
    if (ref.id !== undefined && !validId(ref.id)) deny('Invalid document ID', 400);
    if (ref.name === 'portal_settings' && ref.id && ref.id !== 'attendance_policy') deny();
    const collection = db.collection(ref.name);
    const serialized = snap => ({ id: snap.id, data: snap.exists === false ? null : encode(snap.data()) });
    if (operation === 'list') {
      if (!['collection', 'query'].includes(ref.type) || !Array.isArray(ref.constraints) || ref.constraints.length > 20) deny('Invalid query', 400);
      let q = collection, count = 200, cursor = body.cursor;
      if (ref.name === 'portal_settings') q = q.where(Filter.where('__name__', '==', collection.doc('attendance_policy')));
      else if (ref.name === 'portal_notifications' || !manager(user)) {
        const filters = ref.name === 'portal_notifications'
          ? [Filter.where('recipientId', '==', user.id), Filter.and(Filter.where('recipientId', '==', null), Filter.where('recipientRole', '==', user.role)), Filter.and(Filter.where('recipientId', '==', null), Filter.where('recipientRole', '==', null))]
          : ownerFields(ref.name).map(field => Filter.where(field, '==', user.id));
        q = q.where(Filter.or(...filters));
      }
      for (const c of ref.constraints) {
        if (c.kind === 'where') {
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.field) || !['==', '>=', '<=', '>', '<', 'in', 'array-contains'].includes(c.op)) deny('Invalid query filter', 400);
          if (!manager(user) && ownerFields(ref.name).includes(c.field) && c.op === '==' && c.value !== user.id) deny();
          q = q.where(c.field, c.op, parseValue(c.value, stamp));
        } else if (c.kind === 'order') {
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.field) || !['asc', 'desc'].includes(c.direction)) deny('Invalid sort', 400);
          q = q.orderBy(c.field, c.direction);
        } else if (c.kind === 'limit') { if (!Number.isInteger(c.count) || c.count < 1 || c.count > 10000) deny('Invalid limit', 400); count = Math.min(count, c.count); }
        else if (c.kind === 'cursor') cursor = c.id;
        else deny('Invalid query constraint', 400);
      }
      if (cursor) {
        if (!validId(cursor)) deny('Invalid cursor', 400);
        const snap = await collection.doc(cursor).get();
        if (!snap.exists || !canRead(user, ref.name, snap.data())) deny();
        q = q.startAfter(snap);
      }
      const result = await q.limit(count).get();
      if (result.docs.some(snap => !canRead(user, ref.name, snap.data()))) deny('Conflicting ownership requires review');
      return { rows: result.docs.map(serialized), nextCursor: result.docs.length === count ? result.docs.at(-1).id : null };
    }
    if (operation === 'get') {
      if (!ref.id) deny('Document ID required', 400);
      const snap = await collection.doc(ref.id).get();
      if (!snap.exists) return { id: ref.id, data: null };
      if (!canRead(user, ref.name, snap.data())) deny();
      return serialized(snap);
    }
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) deny('Data required', 400);
    if (operation !== 'add' && !ref.id) deny('Document ID required', 400);
    const target = operation === 'add' ? collection.doc() : collection.doc(ref.id);
    const data = parseValue(body.data, stamp);
    return db.runTransaction(async tx => {
      const snap = await tx.get(target);
      const prior = snap.exists ? snap.data() : null;
      if (operation === 'update' && !prior) deny('Record not found', 404);
      const safe = authorizeWrite(user, ref.name, prior, data, operation);
      if (!prior) { safe.createdAt = stamp(); safe.createdBy = user.id; }
      else delete safe.createdAt;
      if ('updatedAt' in safe) safe.updatedAt = stamp();
      if (operation === 'add') tx.create(target, safe);
      else if (operation === 'update') tx.update(target, safe);
      else tx.set(target, safe, { merge: true });
      return { id: target.id };
    }, { maxAttempts: 1 });
  };
}
