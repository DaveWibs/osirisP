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
      '/api/v1/events',
      '/api/v1/markets/quotes',
      '/api/frontlines',
      '/api/region-dossier',
    ],
  });
}
