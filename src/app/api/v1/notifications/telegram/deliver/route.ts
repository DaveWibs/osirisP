import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { WorldStateService } from '@/lib/worldstate/service';
import { runTelegramNotificationDelivery } from '@/lib/worldstate/telegram-notifier';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const deliveryToken = process.env.WORLDSTATE_TELEGRAM_DELIVERY_TOKEN?.trim();
    if (!deliveryToken) {
      return NextResponse.json({ error: 'Telegram notification delivery is not configured' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (readBearerToken(request) !== deliveryToken) {
      return NextResponse.json({ error: 'Unauthorized' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json({ error: 'World-State database is not configured' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await runTelegramNotificationDelivery({
      environment: process.env,
      service: new WorldStateService(database),
      fetcher: fetch,
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[worldstate:v1:notifications:telegram] Failed to deliver Telegram notifications:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to deliver World-State Telegram notifications' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization === null) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
