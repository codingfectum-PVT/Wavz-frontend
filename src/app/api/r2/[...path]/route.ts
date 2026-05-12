import { NextRequest, NextResponse } from 'next/server';

const R2_BASE = 'https://pub-ba4662261f8d44beb9881f35fde247ee.r2.dev';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const r2Url = `${R2_BASE}/${path}`;

  const r2Res = await fetch(r2Url, { next: { revalidate: 60 } });

  const body = await r2Res.arrayBuffer();
  const contentType = r2Res.headers.get('content-type') ?? 'application/octet-stream';

  return new NextResponse(body, {
    status: r2Res.status,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
