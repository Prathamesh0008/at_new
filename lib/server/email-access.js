import 'server-only';
import { requireUser } from './auth';
import { employees, MANAGER } from '@/utils/constants';
export async function authorizePortalEmail(request, recipient) {
  const user = await requireUser(request);
  const allowed = new Set((user.id === 'NTS-MGR' ? employees.map(row => row.email) : [user.email, MANAGER.email]).filter(Boolean).map(value => value.toLowerCase()));
  const targets = Array.isArray(recipient) ? recipient : [recipient];
  if (!targets.length || targets.some(value => typeof value !== 'string' || !allowed.has(value.toLowerCase()))) throw Object.assign(new Error('Email recipient is not permitted'), { status: 403 });
  return user;
}
