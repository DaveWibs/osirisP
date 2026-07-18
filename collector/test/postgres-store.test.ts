import { describe, expect, it } from 'vitest';

import { rawArchiveCorrelationMetadata } from '../src/storage/postgres-store.js';

describe('rawArchiveCorrelationMetadata', () => {
  it('adds immutable archive correlation context under the OSIRIS namespace', () => {
    const metadata = rawArchiveCorrelationMetadata(
      {
        sourceId: 'usgs-earthquakes',
        runId: '10000000-0000-4000-8000-000000000001',
        archivePath: 'usgs-earthquakes/2026/07/15/raw.geojson.gz',
        feedContentHash: 'a'.repeat(64),
      },
      {
        provider: 'usgs',
        osirisArchive: { collectionRunId: 'provider-supplied-value' },
      },
    );

    expect(metadata).toEqual({
      provider: 'usgs',
      osirisArchive: {
        sourceId: 'usgs-earthquakes',
        collectionRunId: '10000000-0000-4000-8000-000000000001',
        archivePath: 'usgs-earthquakes/2026/07/15/raw.geojson.gz',
        archiveContentHash: 'a'.repeat(64),
      },
    });
  });
});
