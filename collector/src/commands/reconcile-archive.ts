import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import {
  listArchiveFiles,
  listDatabaseArchiveReferences,
  reconcileArchiveReferences,
  summariseArchiveReconciliation,
} from '../storage/archive-reconciliation.js';

async function run(): Promise<number> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const [archiveFiles, databaseArchiveReferences] = await Promise.all([
    listArchiveFiles(config.archiveRoot),
    listDatabaseArchiveReferences(config.databaseConfig),
  ]);
  const result = reconcileArchiveReferences({ archiveFiles, databaseArchiveReferences });
  const summary = summariseArchiveReconciliation(result);

  logger.info(
    {
      archiveRoot: config.archiveRoot,
      archiveFiles: summary.archiveFiles,
      databaseArchiveReferences: summary.databaseArchiveReferences,
      matchedArchiveFiles: summary.matchedArchiveFiles,
      missingArchiveFiles: summary.missingArchiveFiles.count,
      orphanArchiveFiles: summary.orphanArchiveFiles.count,
      status: summary.status,
    },
    'Archive/database reconciliation completed',
  );

  process.stdout.write(`${JSON.stringify({ archiveRoot: config.archiveRoot, ...summary }, null, 2)}\n`);
  return summary.status === 'ok' ? 0 : 2;
}

run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Archive/database reconciliation failed: ${message}\n`);
    process.exitCode = 1;
  });
