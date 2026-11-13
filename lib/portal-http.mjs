export async function readJsonBody(request, maxBytes) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('JSON content type required'), { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('JSON body required'), { status: 400 });
  const chunks = []; let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { status: 413 }); }
    chunks.push(value);
  }
  try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); return body; }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}
