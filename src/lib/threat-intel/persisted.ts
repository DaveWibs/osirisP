import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const FEODO_SOURCE_ID = 'abusech-feodo-ipblocklist';
export const URLHAUS_SOURCE_ID = 'abusech-urlhaus-online';
export const CISA_KEV_SOURCE_ID = 'cisa-known-exploited-vulnerabilities';
export const MALWARE_SOURCE_IDS = [FEODO_SOURCE_ID, URLHAUS_SOURCE_ID];

export interface MalwareThreat {
  id: string;
  lat: number;
  lng: number;
  ip: string;
  port: number;
  malware: string;
  status: string;
  first_seen: string;
  last_online: string;
  country: string;
  threat_type: string;
}

export interface MalwareResponse {
  threats: MalwareThreat[];
  total: number;
  timestamp: string;
  source: string;
}

export interface CyberAttack {
  id: string;
  src_lng: number;
  src_lat: number;
  dst_lng: number;
  dst_lat: number;
  malware: string;
  target_ip: string;
  target_country: string;
  port: number;
  severity: number;
  action: string;
  status: string;
  delay: number;
  duration: number;
}

export interface CyberAttacksResponse {
  attacks: CyberAttack[];
  total: number;
  timestamp: string;
  source: string;
}

export interface CyberThreat {
  id: string;
  name: string;
  vendor: string;
  product: string;
  severity: string;
  date: string;
  due: string | null;
  source: string;
}

export interface CyberThreatsResponse {
  threats: CyberThreat[];
  stats: {
    cisa_total?: number;
    active_cves: number;
    threat_level: string;
  };
  timestamp: string;
}

interface MalwareRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  source_id: string | null;
  source_indicator_id: string | null;
  indicator_value: string | null;
  threat_kind: string | null;
  status: string | null;
  malware_family: string | null;
  port: number | null;
  country_code: string | null;
  observed_at: Date | string | null;
  updated_at: Date | string | null;
}

interface CisaRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  indicator_value: string | null;
  title: string | null;
  observed_at: Date | string | null;
  due_at: Date | string | null;
  vendor_project: string | null;
  product: string | null;
  cisa_total: number | string | null;
}

export interface PersistedMalwareIndicator {
  sourceId: string;
  sourceIndicatorId: string;
  indicatorValue: string;
  threatKind: string;
  status: string | null;
  malwareFamily: string | null;
  port: number | null;
  countryCode: string | null;
  observedAt: Date | null;
  updatedAt: Date | null;
}

export interface PersistedCisaThreat {
  id: string;
  name: string;
  vendor: string;
  product: string;
  date: Date;
  dueAt: Date | null;
}

export interface PersistedCisaRows {
  threats: PersistedCisaThreat[];
  total: number;
}

const MAX_MALWARE_THREATS = 200;
const MAX_ATTACKS = 20;
const RECENT_CVE_DAYS = 30;

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AF:[65,33],AL:[20,41],DZ:[3,28],AO:[18.5,-12.5],AR:[-64,-34],AM:[45,40],AU:[134,-25],AT:[14,47.5],AZ:[50,40.5],
  BD:[90,24],BY:[28,53],BE:[4,50.8],BR:[-51,-10],BG:[25.5,42.7],CA:[-96,62],CL:[-71,-30],
  CN:[105,35],CO:[-72,4],HR:[16,45.2],CZ:[15.5,49.8],DK:[10,56],EG:[30,27],FI:[26,64],
  FR:[2,46],DE:[10,51],GR:[22,39],HK:[114.2,22.3],HU:[19.5,47],IN:[79,22],ID:[120,-5],
  IR:[53,32],IQ:[44,33],IE:[-8,53],IL:[34.8,31.5],IT:[12.5,42.8],JP:[138,36],KZ:[67,48],
  KE:[38,1],KR:[128,36],LT:[24,55.5],MY:[112,3],MX:[-102,23.5],NL:[5.5,52.5],NZ:[174,-41],
  NG:[8,10],NO:[8,62],PK:[70,30],PA:[-80,9],PH:[122,12.5],PL:[19.5,52],PT:[-8,39.5],
  RO:[25,46],RU:[100,60],SA:[45,25],SG:[103.8,1.35],ZA:[24,-29],ES:[-4,40],SE:[16,62],
  CH:[8,47],TW:[121,23.7],TH:[101,15],TR:[35,39],UA:[32,49],AE:[54,24],GB:[-2,54],
  US:[-97,38],VN:[106,16],
};

const THREAT_ORIGINS: Record<string, [number, number][]> = {
  Emotet: [[37.6, 55.7], [30.5, 50.4], [24.1, 56.9], [21.0, 52.2]],
  QakBot: [[37.6, 55.7], [49.1, 55.8], [30.3, 59.9], [27.6, 53.9]],
  Qakbot: [[37.6, 55.7], [49.1, 55.8], [30.3, 59.9], [27.6, 53.9]],
  BumbleBee: [[37.6, 55.7], [24.1, 56.9], [14.4, 50.1]],
  Dridex: [[37.6, 55.7], [30.5, 50.4], [49.1, 55.8]],
  TrickBot: [[37.6, 55.7], [30.5, 50.4], [68.0, 55.0]],
  IcedID: [[37.6, 55.7], [24.1, 56.9], [30.3, 59.9]],
  SystemBC: [[37.6, 55.7], [14.4, 50.1], [21.0, 52.2]],
  Pikabot: [[37.6, 55.7], [30.5, 50.4], [24.1, 56.9]],
  BazarLoader: [[37.6, 55.7], [49.1, 55.8]],
  CobaltStrike: [[116.4, 39.9], [121.5, 31.2], [37.6, 55.7], [113.3, 23.1]],
  PlugX: [[116.4, 39.9], [121.5, 31.2], [113.3, 23.1]],
  ShadowPad: [[116.4, 39.9], [104.1, 30.6], [106.7, 26.6]],
  Winnti: [[116.4, 39.9], [121.5, 31.2]],
  _default: [[37.6, 55.7], [116.4, 39.9], [-73.9, 40.7], [-46.6, -23.5], [28.0, -26.2], [103.8, 1.4]],
};

const SEVERITY: Record<string, number> = {
  Emotet: 9, QakBot: 8, Qakbot: 8, Dridex: 8, TrickBot: 7, IcedID: 7,
  BumbleBee: 7, CobaltStrike: 10, SystemBC: 6, Pikabot: 7, BazarLoader: 8,
  PlugX: 9, ShadowPad: 10, Winnti: 9,
};

const ATTACK_VERBS = [
  'C2 BEACON', 'PAYLOAD DROP', 'EXFILTRATION', 'LATERAL MOVE', 'CREDENTIAL HARVEST',
  'IMPLANT DEPLOY', 'REVERSE SHELL', 'DATA STAGING', 'PERSISTENCE', 'RECON SWEEP',
];

const MALWARE_QUERY = `
WITH latest_per_source AS (
  SELECT DISTINCT ON (source_id)
    source_id,
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = ANY($1)
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY source_id, response_received_at DESC, id DESC
),
latest_success AS (
  SELECT
    MAX(response_received_at) AS response_received_at,
    MAX(upstream_timestamp) AS upstream_timestamp
  FROM latest_per_source
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  threat.source_id,
  threat.source_indicator_id,
  threat.indicator_value,
  threat.threat_kind,
  threat.status,
  threat.malware_family,
  threat.port,
  threat.country_code,
  threat.observed_at,
  threat.updated_at
FROM latest_success
LEFT JOIN LATERAL (
  SELECT
    source_id,
    source_indicator_id,
    indicator_value,
    threat_kind,
    status,
    malware_family,
    port,
    country_code,
    observed_at,
    updated_at,
    normalised_at
  FROM threat_intel_observations
  WHERE source_id = ANY($1)
    AND normalised_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY
    CASE WHEN threat_kind = 'botnet_c2' THEN 0 ELSE 1 END,
    updated_at DESC
  LIMIT ${MAX_MALWARE_THREATS}
) AS threat ON TRUE`;

const CISA_QUERY = `
WITH latest_success AS (
  SELECT
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = $1
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY response_received_at DESC, id DESC
  LIMIT 1
),
cisa_stats AS (
  SELECT COUNT(*) AS cisa_total
  FROM threat_intel_observations
  WHERE source_id = $1
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  threat.indicator_value,
  threat.title,
  threat.observed_at,
  threat.due_at,
  threat.metadata->>'vendorProject' AS vendor_project,
  threat.metadata->>'product' AS product,
  cisa_stats.cisa_total
FROM latest_success
CROSS JOIN cisa_stats
LEFT JOIN LATERAL (
  SELECT indicator_value, title, observed_at, due_at, metadata
  FROM threat_intel_observations
  WHERE source_id = $1
    AND threat_kind = 'exploited_vulnerability'
  ORDER BY observed_at DESC, indicator_value ASC
  LIMIT 100
) AS threat ON TRUE`;

function deterministicJitter(index: number, lngRange: number, latRange: number): [number, number] {
  return [
    ((index * 173.7) % 200 - 100) / 100 * lngRange,
    ((index * 293.1) % 200 - 100) / 100 * latRange,
  ];
}

function extractIpv4(value: string): string | null {
  const match = value.match(/https?:\/\/([0-9]{1,3}(?:\.[0-9]{1,3}){3})/u);
  return match?.[1] ?? null;
}

function mapMalwareRow(row: MalwareRow): PersistedMalwareIndicator | null {
  if (row.source_indicator_id === null || row.indicator_value === null || row.threat_kind === null || row.source_id === null) {
    return null;
  }
  return {
    sourceId: row.source_id,
    sourceIndicatorId: row.source_indicator_id,
    indicatorValue: row.indicator_value,
    threatKind: row.threat_kind,
    status: row.status,
    malwareFamily: row.malware_family,
    port: row.port === null ? null : requirePersistedNumber(row.port, `port for ${row.source_indicator_id}`),
    countryCode: row.country_code,
    observedAt: parsePersistedTimestamp(row.observed_at, 'observed_at'),
    updatedAt: parsePersistedTimestamp(row.updated_at, 'updated_at'),
  };
}

export function buildMalwareResponse(rows: PersistedMalwareIndicator[], now: Date): MalwareResponse {
  const threats: MalwareThreat[] = [];
  rows.forEach((row, index) => {
    if (row.threatKind === 'botnet_c2') {
      const country = row.countryCode;
      if (country === null || COUNTRY_CENTROIDS[country] === undefined) return;
      const [lng, lat] = COUNTRY_CENTROIDS[country];
      const [jLng, jLat] = deterministicJitter(index, 4, 4);
      threats.push({
        id: `feodo-${threats.length}`,
        lat: lat + jLat,
        lng: lng + jLng,
        ip: row.indicatorValue,
        port: row.port ?? 0,
        malware: row.malwareFamily ?? 'unknown',
        status: row.status ?? 'active',
        first_seen: row.observedAt?.toISOString() ?? '',
        last_online: row.updatedAt?.toISOString() ?? '',
        country,
        threat_type: 'botnet_c2',
      });
      return;
    }

    // URLhaus does not persist geolocation. Keep database mode honest by only
    // returning map-ready URL rows when a future normaliser supplies country.
    const ip = extractIpv4(row.indicatorValue);
    const country = row.countryCode;
    if (ip === null || country === null || COUNTRY_CENTROIDS[country] === undefined) return;
    const [lng, lat] = COUNTRY_CENTROIDS[country];
    const [jLng, jLat] = deterministicJitter(index, 4, 4);
    threats.push({
      id: `urlhaus-${threats.length}`,
      lat: lat + jLat,
      lng: lng + jLng,
      ip,
      port: row.port ?? (row.indicatorValue.startsWith('https:') ? 443 : 80),
      malware: row.malwareFamily ?? 'malware',
      status: row.status ?? 'online',
      first_seen: row.observedAt?.toISOString() ?? '',
      last_online: row.updatedAt?.toISOString() ?? now.toISOString(),
      country,
      threat_type: 'malware_url',
    });
  });

  return {
    threats,
    total: threats.length,
    timestamp: now.toISOString(),
    source: 'World-State persisted abuse.ch Feodo/URLhaus indicators',
  };
}

export function buildCyberAttacksResponse(rows: PersistedMalwareIndicator[], now: Date): CyberAttacksResponse {
  const feodoRows = rows.filter((row) => (
    row.threatKind === 'botnet_c2'
    && row.countryCode !== null
    && COUNTRY_CENTROIDS[row.countryCode] !== undefined
  ));
  const multiplier = feodoRows.length > 0 ? Math.max(1, Math.ceil(15 / feodoRows.length)) : 0;
  const attacks: CyberAttack[] = [];
  let id = 0;

  for (const row of feodoRows) {
    const malware = row.malwareFamily ?? 'Unknown';
    const origins = THREAT_ORIGINS[malware] ?? THREAT_ORIGINS._default;
    const country = row.countryCode;
    if (country === null) continue;
    const dst = COUNTRY_CENTROIDS[country];
    if (dst === undefined) continue;

    for (let m = 0; m < multiplier && attacks.length < MAX_ATTACKS; m += 1) {
      const origin = origins[(id + m) % origins.length];
      if (origin === undefined) continue;
      const [srcJitterLng, srcJitterLat] = deterministicJitter(id + m, 8, 5);
      const [dstJitterLng, dstJitterLat] = deterministicJitter(id + m + 7, 6, 4);
      attacks.push({
        id: `ca-${id}`,
        src_lng: origin[0] + srcJitterLng,
        src_lat: origin[1] + srcJitterLat,
        dst_lng: dst[0] + dstJitterLng,
        dst_lat: dst[1] + dstJitterLat,
        malware,
        target_ip: row.indicatorValue,
        target_country: country,
        port: row.port ?? 443,
        severity: SEVERITY[malware] ?? 5,
        action: ATTACK_VERBS[id % ATTACK_VERBS.length] ?? 'C2 BEACON',
        status: row.status ?? 'online',
        delay: (id * 137) % 8000,
        duration: 3000 + ((id * 251) % 3000),
      });
      id += 1;
    }
  }

  return {
    attacks,
    total: attacks.length,
    timestamp: now.toISOString(),
    source: 'World-State persisted Feodo C2 indicators with inferred origin centroids',
  };
}

function mapCisaRow(row: CisaRow): PersistedCisaThreat | null {
  if (row.indicator_value === null || row.title === null) return null;
  const observedAt = parsePersistedTimestamp(row.observed_at, 'observed_at');
  if (observedAt === null) return null;
  return {
    id: row.indicator_value,
    name: row.title,
    vendor: row.vendor_project ?? '',
    product: row.product ?? '',
    date: observedAt,
    dueAt: parsePersistedTimestamp(row.due_at, 'due_at'),
  };
}

export function buildCyberThreatsResponse(rows: PersistedCisaRows, now: Date): CyberThreatsResponse {
  const cutoff = now.getTime() - RECENT_CVE_DAYS * 86_400_000;
  const threats = rows.threats
    .filter((threat) => threat.date.getTime() >= cutoff)
    .slice(0, 10)
    .map((threat) => ({
      id: threat.id,
      name: threat.name,
      vendor: threat.vendor,
      product: threat.product,
      severity: 'CRITICAL',
      date: threat.date.toISOString().slice(0, 10),
      due: threat.dueAt?.toISOString().slice(0, 10) ?? null,
      source: 'CISA KEV',
    }));

  return {
    threats,
    stats: {
      cisa_total: rows.total,
      active_cves: threats.length,
      threat_level: threats.length >= 8 ? 'CRITICAL' : threats.length >= 4 ? 'HIGH' : 'ELEVATED',
    },
    timestamp: now.toISOString(),
  };
}

export async function loadMalwareDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('malware', 'osiris-malware-api'),
): Promise<PersistedDatabaseResult<PersistedMalwareIndicator[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<MalwareRow>(MALWARE_QUERY, [
    MALWARE_SOURCE_IDS,
    `${windowMs} milliseconds`,
  ]);
  return {
    rows: result.rows.flatMap((row) => {
      const mapped = mapMalwareRow(row);
      return mapped === null ? [] : [mapped];
    }),
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}

export async function loadCyberAttacksDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('cyber-attacks', 'osiris-cyber-attacks-api'),
): Promise<PersistedDatabaseResult<PersistedMalwareIndicator[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<MalwareRow>(MALWARE_QUERY, [
    [FEODO_SOURCE_ID],
    `${windowMs} milliseconds`,
  ]);
  return {
    rows: result.rows.flatMap((row) => {
      const mapped = mapMalwareRow(row);
      return mapped === null ? [] : [mapped];
    }),
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}

export async function loadCyberThreatsDatabaseResult(
  _windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('cyber-threats', 'osiris-cyber-threats-api'),
): Promise<PersistedDatabaseResult<PersistedCisaRows> | null> {
  if (executor === null) return null;
  const result = await executor.query<CisaRow>(CISA_QUERY, [CISA_KEV_SOURCE_ID]);
  const total = Number(result.rows[0]?.cisa_total ?? 0);
  return {
    rows: {
      threats: result.rows.flatMap((row) => {
        const mapped = mapCisaRow(row);
        return mapped === null ? [] : [mapped];
      }),
      total: Number.isFinite(total) ? total : 0,
    },
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}
