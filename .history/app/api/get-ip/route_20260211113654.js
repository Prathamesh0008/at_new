import { NextResponse } from 'next/server';

export async function GET(request) {
  // Get IP from headers
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'Unknown';

  return NextResponse.json({ ip });
}
