import { NextResponse } from 'next/server';

import {
  buildAirQualityResponse,
  loadAirQualityDatabaseResult,
  pm25Color,
  type AirQualityResponse,
  type AirQualityStation,
} from '@/lib/air-quality/persisted';
import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
} from '@/lib/persisted/service';

/**
 * OSIRIS — Air Quality Monitoring API
 * Fetches real-time global air quality data from OpenAQ
 * FREE — No API key required
 * Data: PM2.5, PM10, O3, NO2, SO2, CO measurements worldwide
 * AIR_QUALITY_DATA_MODE selects live OpenAQ or the persisted World-State
 * PM2.5 capture with the same station contract.
 */

export const runtime = 'nodejs';

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

async function loadLiveAirQuality(): Promise<AirQualityResponse> {
  // OpenAQ v2 — get latest measurements globally
  // We request PM2.5 (most health-relevant) with coordinates
  const urls = [
    'https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc',
  ];

  const results = await Promise.allSettled(
    urls.map(url =>
      fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      }).then(r => r.json())
    )
  );

  const stations: AirQualityStation[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    for (const loc of data.results || []) {
      if (!loc.coordinates?.latitude || !loc.coordinates?.longitude) continue;
      const pm25 = loc.measurements?.find((m: { parameter: string }) => m.parameter === 'pm25');
      if (!pm25) continue;

      // AQI color coding based on PM2.5 (WHO/EPA scale)
      const val = pm25.value;
      let level = 'Good';
      if (val > 150) level = 'Hazardous';
      else if (val > 100) level = 'Unhealthy';
      else if (val > 55) level = 'Unhealthy (Sensitive)';
      else if (val > 35) level = 'Moderate';

      stations.push({
        id: `aq-${loc.location}`,
        name: loc.location,
        city: loc.city || 'Unknown',
        country: loc.country,
        lat: loc.coordinates.latitude,
        lng: loc.coordinates.longitude,
        pm25: val,
        unit: pm25.unit,
        level,
        color: pm25Color(val),
        lastUpdated: pm25.lastUpdated,
      });
    }
  }

  return {
    stations,
    total: stations.length,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const snapshot = await loadPersistedSnapshot(loadPersistedRuntimeConfig('AIR_QUALITY', process.env, 86_400_000), {
      label: 'air-quality',
      getDatabaseResult: (windowMs) => loadAirQualityDatabaseResult(windowMs),
      buildDatabaseResponse: buildAirQualityResponse,
      loadLive: loadLiveAirQuality,
      warn: (message) => console.warn(message),
    });
    return NextResponse.json(snapshot.response, {
      headers: persistedResponseHeaders('Air-Quality', snapshot, SUCCESS_CACHE_CONTROL),
    });
  } catch (error) {
    if (error instanceof PersistedDatabaseUnavailableError) {
      console.error('[air-quality] Database mode unavailable:', error.message);
      return NextResponse.json(
        { stations: [], error: 'Air quality database unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('Air Quality API error:', error);
    return NextResponse.json({ stations: [], error: 'Failed to fetch air quality data' }, { status: 500 });
  }
}
