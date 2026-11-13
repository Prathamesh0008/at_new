// Transport tags preserve dates without exposing Firestore or session secrets.
export class Timestamp {
  constructor(value) { this.value = new Date(value).toISOString(); }
  toDate() { return new Date(this.value); }
  static fromDate(value) { return new Timestamp(value); }
}
export function encode(value) {
  if (value instanceof Date || value instanceof Timestamp || typeof value?.toDate === 'function') return { $date: (value.toDate?.() || value).toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));
  return value;
}
export function decode(value, stamp = () => ({ $serverTimestamp: true })) {
  if (Array.isArray(value)) return value.map(v => decode(v, stamp));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && value.$date) return new Timestamp(value.$date);
    if (Object.keys(value).length === 1 && value.$serverTimestamp === true) return stamp();
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v, stamp)]));
  }
  return value;
}
