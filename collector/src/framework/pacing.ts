import { type Logger } from "pino";

export interface PacedCollector {
  readonly sourceId: string;
  collect(signal?: AbortSignal): Promise<unknown>;
}

/**
 * Limits how often a collector actually runs inside the shared polling cycle.
 * Providers such as CelesTrak refresh their catalogues on multi-hour cadences
 * and IP-ban clients that poll faster; skipped cycles record nothing, so the
 * source's run history only reflects real attempts.
 */
export function withMinimumInterval(
  collector: PacedCollector,
  minIntervalMs: number,
  logger: Logger,
  now: () => number = Date.now,
): PacedCollector {
  if (!Number.isSafeInteger(minIntervalMs) || minIntervalMs <= 0) {
    throw new Error("minIntervalMs must be a positive integer");
  }

  let lastAttemptAt: number | null = null;

  return {
    sourceId: collector.sourceId,
    async collect(signal?: AbortSignal): Promise<unknown> {
      const current = now();
      if (lastAttemptAt !== null && current - lastAttemptAt < minIntervalMs) {
        logger.debug(
          {
            sourceId: collector.sourceId,
            minIntervalMs,
            nextAttemptInMs: minIntervalMs - (current - lastAttemptAt),
          },
          "Skipping collection to respect provider pacing",
        );
        return undefined;
      }
      lastAttemptAt = current;
      return collector.collect(signal);
    },
  };
}
