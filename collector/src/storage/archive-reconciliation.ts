import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

const ARCHIVE_FILE_SUFFIX = '.gz';

interface ArchiveReferenceRow extends QueryResultRow {
  archive_path: string;
}

export interface ArchiveReconciliationInput {
  archiveFiles: Iterable<string>;
  databaseArchiveReferences: Iterable<string>;
}

export interface ArchiveReconciliationResult {
  archiveFiles: string[];
  databaseArchiveReferences: string[];
  matchedArchiveFiles: string[];
  missingArchiveFiles: string[];
  orphanArchiveFiles: string[];
}

export interface ArchiveReconciliationSummary {
  status: 'ok' | 'drift';
  archiveFiles: number;
  databaseArchiveReferences: number;
  matchedArchiveFiles: number;
  missingArchiveFiles: {
    count: number;
    sample: string[];
    truncated: boolean;
  };
  orphanArchiveFiles: {
    count: number;
    sample: string[];
    truncated: boolean;
  };
}

export function reconcileArchiveReferences(
  input: ArchiveReconciliationInput,
): ArchiveReconciliationResult {
  const archiveFiles = uniqueSorted(input.archiveFiles);
  const databaseArchiveReferences = uniqueSorted(input.databaseArchiveReferences);
  const archiveFileSet = new Set(archiveFiles);
  const databaseReferenceSet = new Set(databaseArchiveReferences);

  return {
    archiveFiles,
    databaseArchiveReferences,
    matchedArchiveFiles: archiveFiles.filter((path) => databaseReferenceSet.has(path)),
    missingArchiveFiles: databaseArchiveReferences.filter((path) => !archiveFileSet.has(path)),
    orphanArchiveFiles: archiveFiles.filter((path) => !databaseReferenceSet.has(path)),
  };
}

export function summariseArchiveReconciliation(
  result: ArchiveReconciliationResult,
  sampleLimit = 100,
): ArchiveReconciliationSummary {
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) {
    throw new Error('sampleLimit must be a positive integer');
  }

  return {
    status: result.missingArchiveFiles.length === 0 && result.orphanArchiveFiles.length === 0
      ? 'ok'
      : 'drift',
    archiveFiles: result.archiveFiles.length,
    databaseArchiveReferences: result.databaseArchiveReferences.length,
    matchedArchiveFiles: result.matchedArchiveFiles.length,
    missingArchiveFiles: sample(result.missingArchiveFiles, sampleLimit),
    orphanArchiveFiles: sample(result.orphanArchiveFiles, sampleLimit),
  };
}

export async function listArchiveFiles(archiveRoot: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(ARCHIVE_FILE_SUFFIX)) {
        files.push(relative(archiveRoot, absolutePath));
      }
    }
  }

  await visit(archiveRoot);
  return uniqueSorted(files);
}

export async function listDatabaseArchiveReferences(
  databaseConfig: PoolConfig,
): Promise<string[]> {
  const pool = new Pool(databaseConfig);

  try {
    const result = await pool.query<ArchiveReferenceRow>(
      `SELECT DISTINCT archive_path
       FROM (
         SELECT archive_path
         FROM collection_runs
         WHERE archive_path IS NOT NULL
           AND archive_path <> ''
         UNION
         SELECT archive_path
         FROM raw_observations
         WHERE archive_path IS NOT NULL
           AND archive_path <> ''
       ) AS archive_references
       ORDER BY archive_path`,
    );

    return result.rows.map((row) => row.archive_path);
  } finally {
    await pool.end();
  }
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

function sample(values: string[], sampleLimit: number): ArchiveReconciliationSummary['missingArchiveFiles'] {
  return {
    count: values.length,
    sample: values.slice(0, sampleLimit),
    truncated: values.length > sampleLimit,
  };
}
