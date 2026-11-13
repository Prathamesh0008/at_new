import { getDocs as sdkGetDocs, getDoc as sdkGetDoc, queryEqual, refEqual } from 'firebase/firestore';
import { portalReads, PORTAL_CACHE_MS } from './portal-read-policy.mjs';

const sameQuery = (a, b) => ['query', 'collection'].includes(a?.type) && ['query', 'collection'].includes(b?.type) && queryEqual(a, b);
const sameDocument = (a, b) => a?.type === 'document' && b?.type === 'document' && refEqual(a, b);
export const getDocs = (ref, { maxAge = PORTAL_CACHE_MS } = {}) => portalReads.run(ref, () => sdkGetDocs(ref), sameQuery, maxAge);
// Mutation precondition reads must never use a cached document snapshot.
export const getDoc = (ref, { maxAge = 0 } = {}) => portalReads.run(ref, () => sdkGetDoc(ref), sameDocument, maxAge);
