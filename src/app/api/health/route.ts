import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'operational',
    platform: 'OSIRIS',
    version: '1.0.0',
    uptime: process.uptime ? Math.round(process.uptime()) : 0,
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/flights',
      '/api/satellites',
      '/api/earthquakes',
      '/api/news',
      '/api/gdelt',
      '/api/markets',
      '/api/v1/sources',
      '/api/v1/sources/[id]',
      '/api/v1/sources/[id]/runs',
      '/api/v1/operations/summary',
      '/api/v1/operations/alerts',
      '/api/v1/operations/diagnostics',
      '/api/v1/readiness',
      '/api/v1/coverage',
      '/api/v1/events',
      '/api/v1/events/[id]',
      '/api/v1/runs',
      '/api/v1/raw/[id]',
      '/api/v1/runs/[id]',
      '/api/v1/runs/[id]/raw',
      '/api/v1/markets/quotes',
      '/api/v1/alerts',
      '/api/frontlines',
      '/api/region-dossier',
    ],
  });
}
