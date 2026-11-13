import { createManagerApi } from '@/lib/manager-api.mjs';
import { createManagerStore } from '@/lib/manager-store.mjs';
import { managerFirebase } from '@/lib/server/manager-firebase';

export const runtime = 'nodejs';
const handle = createManagerApi({ services: async () => {
  const deps = await managerFirebase();
  return { auth: deps.auth, store: createManagerStore(deps) };
} });
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
