import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import {
  CISA_KEV_SOURCE_ID,
  FEODO_SOURCE_ID,
  MALWARE_SOURCE_IDS,
  buildCyberAttacksResponse,
  buildCyberThreatsResponse,
  buildMalwareResponse,
  loadCyberAttacksDatabaseResult,
  loadCyberThreatsDatabaseResult,
  loadMalwareDatabaseResult,
} from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadMalwareDatabaseResult', () => {
  it('loads current persisted abuse.ch indicators by normalisation snapshot', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:58:00Z',
        upstream_timestamp: '2026-07-18T11:55:00Z',
        source_id: 'abusech-feodo-ipblocklist',
        source_indicator_id: '203.0.113.10:443',
        indicator_value: '203.0.113.10',
        threat_kind: 'botnet_c2',
        status: 'online',
        malware_family: 'QakBot',
        port: 443,
        country_code: 'US',
        observed_at: '2026-07-10T00:00:00Z',
        updated_at: '2026-07-18T11:00:00Z',
      },
    ]);

    const result = await loadMalwareDatabaseResult(86_400_000, executor);

    expect(executor.calls[0]?.values).toEqual([MALWARE_SOURCE_IDS, '86400000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('threat_intel_observations');
    expect(executor.calls[0]?.queryText).toContain('normalised_at');
    expect(result?.rows[0]).toMatchObject({
      sourceId: 'abusech-feodo-ipblocklist',
      sourceIndicatorId: '203.0.113.10:443',
      malwareFamily: 'QakBot',
      countryCode: 'US',
    });
  });

  it('returns null when unconfigured', async () => {
    expect(await loadMalwareDatabaseResult(86_400_000, null)).toBeNull();
  });
});

describe('loadCyberThreatsDatabaseResult', () => {
  it('loads persisted CISA KEV rows and catalogue count', async () => {
    const executor = new FakePersistedExecutor([
      {
        response_received_at: '2026-07-18T11:58:00Z',
        upstream_timestamp: '2026-07-18T11:55:00Z',
        indicator_value: 'CVE-2026-1234',
        title: 'Example Product Vulnerability',
        observed_at: '2026-07-17T00:00:00Z',
        due_at: '2026-08-07T00:00:00Z',
        vendor_project: 'ExampleVendor',
        product: 'ExampleProduct',
        cisa_total: '1200',
      },
    ]);

    const result = await loadCyberThreatsDatabaseResult(86_400_000, executor);

    expect(executor.calls[0]?.values).toEqual([CISA_KEV_SOURCE_ID]);
    expect(executor.calls[0]?.queryText).toContain('threat_kind =');
    expect(result?.rows.total).toBe(1200);
    expect(result?.rows.threats[0]).toMatchObject({
      id: 'CVE-2026-1234',
      vendor: 'ExampleVendor',
      product: 'ExampleProduct',
    });
  });
});

describe('loadCyberAttacksDatabaseResult', () => {
  it('keys the cyber-attack snapshot to Feodo only', async () => {
    const executor = new FakePersistedExecutor([]);

    await loadCyberAttacksDatabaseResult(86_400_000, executor);

    expect(executor.calls[0]?.values).toEqual([[FEODO_SOURCE_ID], '86400000 milliseconds']);
  });
});

describe('threat-intel response builders', () => {
  const indicator = {
    sourceId: 'abusech-feodo-ipblocklist',
    sourceIndicatorId: '203.0.113.10:443',
    indicatorValue: '203.0.113.10',
    threatKind: 'botnet_c2',
    status: 'online',
    malwareFamily: 'QakBot',
    port: 443,
    countryCode: 'US',
    observedAt: new Date('2026-07-10T00:00:00Z'),
    updatedAt: new Date('2026-07-18T11:00:00Z'),
  };

  it('builds map-ready malware rows without inventing URLhaus geolocation', () => {
    const response = buildMalwareResponse([
      indicator,
      {
        ...indicator,
        sourceId: 'abusech-urlhaus-online',
        sourceIndicatorId: '3887133',
        indicatorValue: 'http://198.51.100.5/bin.sh',
        threatKind: 'malware_url',
        countryCode: null,
      },
    ], NOW);

    expect(response.total).toBe(1);
    expect(response.threats[0]).toMatchObject({
      ip: '203.0.113.10',
      malware: 'QakBot',
      country: 'US',
      threat_type: 'botnet_c2',
    });
  });

  it('builds deterministic inferred cyber-attack arcs from Feodo C2 indicators', () => {
    const response = buildCyberAttacksResponse([indicator], NOW);

    expect(response.total).toBeGreaterThan(0);
    expect(response.source).toContain('inferred origin centroids');
    expect(response.attacks[0]).toMatchObject({
      malware: 'QakBot',
      target_ip: '203.0.113.10',
      target_country: 'US',
      port: 443,
      action: 'C2 BEACON',
    });
  });

  it('builds the CISA KEV contract from recent persisted CVEs', () => {
    const response = buildCyberThreatsResponse({
      total: 1200,
      threats: [
        {
          id: 'CVE-2026-1234',
          name: 'Example Product Vulnerability',
          vendor: 'ExampleVendor',
          product: 'ExampleProduct',
          date: new Date('2026-07-17T00:00:00Z'),
          dueAt: new Date('2026-08-07T00:00:00Z'),
        },
        {
          id: 'CVE-2026-0001',
          name: 'Old Vulnerability',
          vendor: 'OldVendor',
          product: 'OldProduct',
          date: new Date('2026-05-01T00:00:00Z'),
          dueAt: null,
        },
      ],
    }, NOW);

    expect(response.threats).toEqual([
      {
        id: 'CVE-2026-1234',
        name: 'Example Product Vulnerability',
        vendor: 'ExampleVendor',
        product: 'ExampleProduct',
        severity: 'CRITICAL',
        date: '2026-07-17',
        due: '2026-08-07',
        source: 'CISA KEV',
      },
    ]);
    expect(response.stats).toEqual({
      cisa_total: 1200,
      active_cves: 1,
      threat_level: 'ELEVATED',
    });
  });
});
