import 'server-only';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Keep the client and its readiness promise across development module reloads.
const cache = globalThis.__ntsFirebaseAdmin ??= { pending: null, ready: null, retryAt: 0 };
const APP_NAME = 'attendance-server';
const unavailable = () => Object.assign(new Error(
  'Authentication service unavailable. Ask the administrator to check Firebase Admin credentials.'
), { status: 503, code: 'FIREBASE_ADMIN_CREDENTIALS_UNAVAILABLE' });

function adminOptions() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId || (process.env.FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)) throw unavailable();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Never log parse errors, private keys, credential paths or Google error objects.
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!account.project_id || !account.client_email || !account.private_key ||
        (projectId && projectId !== account.project_id)) throw unavailable();
    return { credential: cert(account), projectId: projectId || account.project_id };
  }
  const explicitFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const wellKnownFile = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'gcloud', 'application_default_credentials.json')
    : path.join(process.env.CLOUDSDK_CONFIG || path.join(homedir(), '.config', 'gcloud'), 'application_default_credentials.json');
  const managedRuntime = process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.GAE_SERVICE;
  if (explicitFile ? !existsSync(explicitFile) : !existsSync(wellKnownFile) && !managedRuntime && process.env.FIREBASE_USE_ADC !== 'true') {
    throw unavailable();
  }
  return { credential: applicationDefault(), ...(projectId ? { projectId } : {}) };
}

export async function serverDb() {
  if (cache.ready) return cache.ready;
  if (Date.now() < cache.retryAt) throw unavailable();
  if (!cache.pending) {
    // Preflight ADC before creating a Firestore client. This prevents failed
    // credential discovery from entering Firestore/GAX initialization/retry chains.
    cache.pending = (async () => {
      try {
        const app = getApps().find(app => app.name === APP_NAME) || initializeApp(adminOptions(), APP_NAME);
        await app.options.credential.getAccessToken();
        const db = getFirestore(app);
        cache.ready = db;
        return db;
      } catch {
        cache.retryAt = Date.now() + 30_000;
        throw unavailable();
      }
    })();
  }
  try { return await cache.pending; }
  finally { cache.pending = null; }
}
