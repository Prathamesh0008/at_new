import 'server-only';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { createManagerCredentialAuth } from '../manager-auth.mjs';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import legacyHashes from './legacy-password-hashes.json';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { fail } from '../manager-domain.mjs';
import { serverDb } from './firebase';

// No SDK initialization or credential discovery on import.
// Prefer the existing server connection; retain explicit manager credentials when supplied.
export async function managerFirebase() {
  const raw = process.env.MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const serverProject = process.env.FIREBASE_PROJECT_ID;
  if (serverProject && projectId && serverProject !== projectId) fail('Manager database project configuration mismatch', 503);
  let db;
  if (raw) {
    if (!projectId) fail('Manager Firebase project is not configured', 503);
    let account;
    try { account = JSON.parse(raw); } catch { fail('Invalid manager Firebase configuration', 503); }
    if (account.project_id !== projectId || !account.private_key || !account.client_email) fail('Invalid manager Firebase configuration', 503);
    const app = getApps().find(a => a.name === 'manager-attendance-isolated') || initializeApp({ credential: cert(account), projectId }, 'manager-attendance-isolated');
    db = getFirestore(app);
  } else {
    // Same trusted server connection as the existing portal; never client Firebase.
    db = await serverDb();
  }
  return { auth: createManagerCredentialAuth(db, password => !legacyHashes['NTS-MGR'] || !timingSafeEqual(scryptSync(password, 'NTS-MGR', 64), Buffer.from(legacyHashes['NTS-MGR'], 'hex'))), db, stamp: () => FieldValue.serverTimestamp(), timestamp: date => Timestamp.fromDate(date) };
}
