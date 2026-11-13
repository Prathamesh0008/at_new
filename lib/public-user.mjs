const USER_FIELDS = ['id', 'name', 'email', 'phone', 'shift', 'role', 'department', 'dateOfJoining'];
export function publicUser(user) {
  if (!user) return null;
  return Object.fromEntries(USER_FIELDS.map(field => [field, typeof user[field] === 'string' ? user[field] : null]));
}
export function safeSessionError(error) {
  const status = [400, 401, 403, 429].includes(error?.status) ? error.status : 503;
  const messages = { 400: 'Invalid sign-in request', 401: 'Authentication required', 403: 'Access denied', 429: 'Too many attempts; try again later', 503: 'Sign-in service unavailable. Please contact the administrator.' };
  return Response.json({ error: messages[status] }, { status, headers: { 'Cache-Control': 'no-store' } });
}
