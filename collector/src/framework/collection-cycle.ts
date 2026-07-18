import { randomUUID } from "node:crypto";
import { type Logger } from "pino";
import { toSafeError } from "./errors.js";

export interface CycleCollector {
  readonly sourceId: string;
  collect(signal?: AbortSignal): Promise<unknown>;
}

export interface RunCollectionCycleOptions {
  collectors: readonly CycleCollector[];
  logger: Logger;
  signal?: AbortSignal;
  sourceIds: readonly string[];
  cycleIdFactory?: () => string;
  now?: () => number;
}

export async function runCollectionCycle(options: RunCollectionCycleOptions): Promise<void> {
  const collectionCycleId = (options.cycleIdFactory ?? randomUUID)();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const failures: unknown[] = [];

  options.logger.info(
    { collectionCycleId, sourceCount: options.collectors.length, sourceIds: options.sourceIds },
    "Configured source collection cycle started",
  );

  for (const collector of options.collectors) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Collection aborted");
    }

    try {
      options.logger.debug(
        { collectionCycleId, sourceId: collector.sourceId },
        "Configured source collection started",
      );
      await collector.collect(options.signal);
      options.logger.debug(
        { collectionCycleId, sourceId: collector.sourceId },
        "Configured source collection succeeded",
      );
    } catch (error) {
      options.logger.error(
        { collectionCycleId, error: toSafeError(error), sourceId: collector.sourceId },
        "Configured source collection failed",
      );
      failures.push(error);
    }
  }

  const durationMs = now() - startedAt;
  if (failures.length > 0) {
    options.logger.error(
      {
        collectionCycleId,
        durationMs,
        failedSources: failures.length,
        sourceCount: options.collectors.length,
        sourceIds: options.sourceIds,
      },
      "Configured source collection cycle failed",
    );
    throw new AggregateError(failures, "One or more configured sources failed");
  }

  options.logger.info(
    { collectionCycleId, durationMs, sourceCount: options.collectors.length, sourceIds: options.sourceIds },
    "Configured source collection cycle completed",
  );
}
