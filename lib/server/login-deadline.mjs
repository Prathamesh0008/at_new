export function withLoginDeadline(operation, timeoutMs = 10000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error('Sign-in service timed out. Please try again later or contact the administrator.'),
      { status: 503 }
    )), Math.max(1, timeoutMs));
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
