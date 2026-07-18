import { NextResponse } from 'next/server';

import { buildCryptoResponse, loadCryptoDatabaseResult, type CryptoResponse } from '@/lib/crypto/persisted';
import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
} from '@/lib/persisted/service';

export const runtime = 'nodejs';

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=120';

async function loadLiveCrypto(): Promise<CryptoResponse> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd', {
    next: { revalidate: 60 } // cache for 60 seconds
  });

  if (!res.ok) {
    throw new Error(`CoinGecko responded with ${res.status}`);
  }

  const data = await res.json();
  const prices: CryptoResponse = [];

  if (data.bitcoin?.usd) prices.push({ symbol: 'BTC', price: data.bitcoin.usd });
  if (data.ethereum?.usd) prices.push({ symbol: 'ETH', price: data.ethereum.usd });
  if (data.solana?.usd) prices.push({ symbol: 'SOL', price: data.solana.usd });

  return prices;
}

export async function GET() {
  try {
    const snapshot = await loadPersistedSnapshot(loadPersistedRuntimeConfig('CRYPTO'), {
      label: 'crypto',
      getDatabaseResult: (windowMs) => loadCryptoDatabaseResult(windowMs),
      buildDatabaseResponse: (rows) => buildCryptoResponse(rows),
      loadLive: loadLiveCrypto,
      warn: (message) => console.warn(message),
    });
    return NextResponse.json(snapshot.response, {
      headers: persistedResponseHeaders('Crypto', snapshot, SUCCESS_CACHE_CONTROL),
    });
  } catch (error) {
    if (error instanceof PersistedDatabaseUnavailableError) {
      console.error('[crypto] Database mode unavailable:', error.message);
      return NextResponse.json([], { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('Failed to fetch crypto prices:', error);
    return NextResponse.json([]); // Return empty if entirely failed, no static fallbacks
  }
}
