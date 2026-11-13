export function createLoginQuotaCooldown(now = () => Date.now()) {
  let until = 0;
  return {
    block: () => { until = now() + 60000; },
    check: () => {
      if (now() < until) throw Object.assign(new Error('Firestore quota exceeded. Sign-in remains unavailable until database quota is restored.'), { status: 503, code: 'LOGIN_FIRESTORE_QUOTA_EXCEEDED' });
    },
  };
}
// No authentication results or rate-limit counters are cached here.
export const loginQuotaCooldown = globalThis.__ntsLoginQuotaCooldown ??= createLoginQuotaCooldown();
