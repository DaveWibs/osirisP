import { NextResponse } from 'next/server';
import {
  buildCyberThreatsResponse,
  loadCyberThreatsDatabaseResult,
  type CyberThreatsResponse,
} from '@/lib/threat-intel/persisted';
import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
} from '@/lib/persisted/service';

export const runtime = 'nodejs';

// Cyber threat intelligence from public feeds
// Inspired by WorldMonitor's infrastructure tracking
interface CisaLiveVulnerability {
  cveID?: string;
  vulnerabilityName?: string;
  vendorProject?: string;
  product?: string;
  dateAdded?: string;
  dueDate?: string;
}

interface CisaLiveResponse {
  vulnerabilities?: CisaLiveVulnerability[];
}

async function loadLiveCyberThreats(): Promise<CyberThreatsResponse> {
  const results: CyberThreatsResponse = { threats: [], stats: { active_cves: 0, threat_level: 'LOW' }, timestamp: new Date().toISOString() };

  // 1. CISA Known Exploited Vulnerabilities (authoritative US govt source)
  try {
    const res = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
    });
    if (res.ok) {
      const data = await res.json() as CisaLiveResponse;
      const recent = (data.vulnerabilities || [])
        .filter((v) => {
          if (!v.dateAdded) return false;
          const added = new Date(v.dateAdded);
          const daysAgo = (Date.now() - added.getTime()) / (1000 * 60 * 60 * 24);
          return daysAgo <= 30;
        })
        .slice(0, 10)
        .map((v) => ({
          id: v.cveID ?? '',
          name: v.vulnerabilityName ?? '',
          vendor: v.vendorProject ?? '',
          product: v.product ?? '',
          severity: 'CRITICAL',
          date: v.dateAdded ?? '',
          due: v.dueDate ?? null,
          source: 'CISA KEV',
        }));
      results.threats.push(...recent);
      results.stats.cisa_total = data.vulnerabilities?.length || 0;
    }
  } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }

  // 2. Shadowserver honeypot stats (global attack surface)
  try {
    const res = await fetch('https://dashboard.shadowserver.org/statistics/combined/map/', {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      (results.stats as CyberThreatsResponse['stats'] & { shadowserver?: string }).shadowserver = 'active';
    }
  } catch {
    (results.stats as CyberThreatsResponse['stats'] & { shadowserver?: string }).shadowserver = 'unavailable';
  }

  // 3. Aggregate stats
  results.stats.active_cves = results.threats.length;
  results.stats.threat_level = results.threats.length >= 8 ? 'CRITICAL' : results.threats.length >= 4 ? 'HIGH' : 'ELEVATED';

  return results;
}

export async function GET() {
  try {
    const snapshot = await loadPersistedSnapshot(loadPersistedRuntimeConfig('CYBER_THREATS', process.env, 86_400_000), {
      label: 'cyber-threats',
      getDatabaseResult: (windowMs) => loadCyberThreatsDatabaseResult(windowMs),
      buildDatabaseResponse: buildCyberThreatsResponse,
      loadLive: loadLiveCyberThreats,
      warn: (message) => console.warn(message),
    });
    return NextResponse.json(snapshot.response, {
      headers: persistedResponseHeaders('Cyber-Threats', snapshot, 'public, s-maxage=300, stale-while-revalidate=600'),
    });
  } catch (error) {
    if (error instanceof PersistedDatabaseUnavailableError) {
      console.error('[cyber-threats] Database mode unavailable:', error.message);
      return NextResponse.json(
        { threats: [], stats: {}, error: 'Cyber-threat database unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json({ threats: [], stats: {}, error: 'Failed' }, { status: 500 });
  }
}
