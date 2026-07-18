import { NextResponse } from 'next/server';

import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
} from '@/lib/persisted/service';
import {
  buildSpaceWeatherResponse,
  loadSpaceWeatherDatabaseResult,
  stormLevel,
  type SpaceWeatherAlert,
  type SpaceWeatherFlare,
  type SpaceWeatherResponse,
} from '@/lib/space-weather/persisted';

/**
 * OSIRIS — Space Weather API
 * Fetches real-time solar activity from NOAA Space Weather Prediction Center
 * FREE — No API key required
 * Data: Kp index (geomagnetic), solar flares, CME alerts
 * SPACE_WEATHER_DATA_MODE selects live NOAA SWPC queries or the persisted
 * World-State capture with the same response contract.
 */

export const runtime = 'nodejs';

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

async function loadLiveSpaceWeather(): Promise<SpaceWeatherResponse> {
  const [kpRes, alertsRes, flareRes] = await Promise.allSettled([
    fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()),
    fetch('https://services.swpc.noaa.gov/products/alerts.json', {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()),
    fetch('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()),
  ]);

  // Latest Kp index (geomagnetic storm indicator)
  let kpIndex = 0;
  let kpTimestamp = '';
  if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 0) {
    const latest = kpRes.value[kpRes.value.length - 1];
    kpIndex = parseFloat(latest.kp_index || latest.Kp || 0);
    kpTimestamp = latest.time_tag || '';
  }

  const storm = stormLevel(kpIndex);

  // Recent alerts
  const alerts: SpaceWeatherAlert[] = [];
  if (alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value)) {
    for (const alert of alertsRes.value.slice(0, 10)) {
      alerts.push({
        id: alert.product_id || `alert-${Date.now()}`,
        issue_datetime: alert.issue_datetime,
        message: (alert.message || '').substring(0, 200),
      });
    }
  }

  // Recent solar flares
  const flares: SpaceWeatherFlare[] = [];
  if (flareRes.status === 'fulfilled' && Array.isArray(flareRes.value)) {
    for (const flare of flareRes.value.slice(0, 5)) {
      if (!flare.max_class) continue;
      flares.push({
        class: flare.max_class,
        begin: flare.begin_time,
        peak: flare.max_time,
        end: flare.end_time,
      });
    }
  }

  return {
    kp_index: kpIndex,
    storm_level: storm.level,
    storm_color: storm.color,
    kp_timestamp: kpTimestamp,
    alerts,
    solar_flares: flares,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const snapshot = await loadPersistedSnapshot(loadPersistedRuntimeConfig('SPACE_WEATHER', process.env, 86_400_000), {
      label: 'space-weather',
      getDatabaseResult: (windowMs) => loadSpaceWeatherDatabaseResult(windowMs),
      buildDatabaseResponse: buildSpaceWeatherResponse,
      loadLive: loadLiveSpaceWeather,
      warn: (message) => console.warn(message),
    });
    return NextResponse.json(snapshot.response, {
      headers: persistedResponseHeaders('Space-Weather', snapshot, SUCCESS_CACHE_CONTROL),
    });
  } catch (error) {
    if (error instanceof PersistedDatabaseUnavailableError) {
      console.error('[space-weather] Database mode unavailable:', error.message);
      return NextResponse.json({
        kp_index: 0, storm_level: 'Unknown', storm_color: '#555',
        alerts: [], solar_flares: [], error: 'Space weather database unavailable',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('Space Weather API error:', error);
    return NextResponse.json({
      kp_index: 0, storm_level: 'Unknown', storm_color: '#555',
      alerts: [], solar_flares: [], error: 'Failed to fetch space weather data',
    }, { status: 500 });
  }
}
