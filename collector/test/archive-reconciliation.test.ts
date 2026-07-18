import { describe, expect, it } from 'vitest';

import {
  reconcileArchiveReferences,
  summariseArchiveReconciliation,
} from '../src/storage/archive-reconciliation.js';

describe('reconcileArchiveReferences', () => {
  it('matches database archive references to archive files', () => {
    const result = reconcileArchiveReferences({
      archiveFiles: [
        'usgs-earthquakes/2026/07/15/a.geojson.gz',
        'gdacs-disasters/2026/07/15/b.xml.gz',
      ],
      databaseArchiveReferences: [
        'gdacs-disasters/2026/07/15/b.xml.gz',
        'usgs-earthquakes/2026/07/15/a.geojson.gz',
      ],
    });

    expect(result).toEqual({
      archiveFiles: [
        'gdacs-disasters/2026/07/15/b.xml.gz',
        'usgs-earthquakes/2026/07/15/a.geojson.gz',
      ],
      databaseArchiveReferences: [
        'gdacs-disasters/2026/07/15/b.xml.gz',
        'usgs-earthquakes/2026/07/15/a.geojson.gz',
      ],
      matchedArchiveFiles: [
        'gdacs-disasters/2026/07/15/b.xml.gz',
        'usgs-earthquakes/2026/07/15/a.geojson.gz',
      ],
      missingArchiveFiles: [],
      orphanArchiveFiles: [],
    });
  });

  it('reports missing database-referenced files and orphan archive files', () => {
    const result = reconcileArchiveReferences({
      archiveFiles: [
        'matched/source/2026/07/15/a.json.gz',
        'orphan/source/2026/07/15/b.json.gz',
      ],
      databaseArchiveReferences: [
        'matched/source/2026/07/15/a.json.gz',
        'missing/source/2026/07/15/c.json.gz',
      ],
    });

    expect(result.missingArchiveFiles).toEqual(['missing/source/2026/07/15/c.json.gz']);
    expect(result.orphanArchiveFiles).toEqual(['orphan/source/2026/07/15/b.json.gz']);
  });
});

describe('summariseArchiveReconciliation', () => {
  it('returns drift status with bounded samples', () => {
    const summary = summariseArchiveReconciliation(
      {
        archiveFiles: ['a.gz', 'b.gz', 'c.gz'],
        databaseArchiveReferences: ['a.gz', 'd.gz', 'e.gz'],
        matchedArchiveFiles: ['a.gz'],
        missingArchiveFiles: ['d.gz', 'e.gz'],
        orphanArchiveFiles: ['b.gz', 'c.gz'],
      },
      1,
    );

    expect(summary).toEqual({
      status: 'drift',
      archiveFiles: 3,
      databaseArchiveReferences: 3,
      matchedArchiveFiles: 1,
      missingArchiveFiles: {
        count: 2,
        sample: ['d.gz'],
        truncated: true,
      },
      orphanArchiveFiles: {
        count: 2,
        sample: ['b.gz'],
        truncated: true,
      },
    });
  });
});
