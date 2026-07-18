import { type Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { runCollectionCycle, type CycleCollector } from "../src/framework/collection-cycle.js";

type TestLogger = Pick<Logger, "debug" | "error" | "info">;

describe("runCollectionCycle", () => {
  it("logs cycle and source success context", async () => {
    const logger = fakeLogger();
    const collector = collectorFor("source-a");

    await runCollectionCycle({
      collectors: [collector],
      cycleIdFactory: () => "cycle-1",
      logger: logger as Logger,
      now: sequenceClock(1_000, 1_250),
      sourceIds: ["source-a"],
    });

    expect(logger.info).toHaveBeenCalledWith(
      { collectionCycleId: "cycle-1", sourceCount: 1, sourceIds: ["source-a"] },
      "Configured source collection cycle started",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { collectionCycleId: "cycle-1", sourceId: "source-a" },
      "Configured source collection started",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { collectionCycleId: "cycle-1", sourceId: "source-a" },
      "Configured source collection succeeded",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { collectionCycleId: "cycle-1", durationMs: 250, sourceCount: 1, sourceIds: ["source-a"] },
      "Configured source collection cycle completed",
    );
  });

  it("logs source and cycle failure context before throwing an aggregate error", async () => {
    const logger = fakeLogger();
    const failure = new Error("feed failed");

    await expect(runCollectionCycle({
      collectors: [collectorFor("source-a"), collectorFor("source-b", failure)],
      cycleIdFactory: () => "cycle-2",
      logger: logger as Logger,
      now: sequenceClock(2_000, 2_300),
      sourceIds: ["source-a", "source-b"],
    })).rejects.toThrow(AggregateError);

    expect(logger.error).toHaveBeenCalledWith(
      {
        collectionCycleId: "cycle-2",
        error: { message: "feed failed", name: "Error" },
        sourceId: "source-b",
      },
      "Configured source collection failed",
    );
    expect(logger.error).toHaveBeenCalledWith(
      {
        collectionCycleId: "cycle-2",
        durationMs: 300,
        failedSources: 1,
        sourceCount: 2,
        sourceIds: ["source-a", "source-b"],
      },
      "Configured source collection cycle failed",
    );
  });
});

function collectorFor(sourceId: string, failure?: Error): CycleCollector {
  return {
    sourceId,
    collect: failure === undefined
      ? vi.fn().mockResolvedValue({ ok: true })
      : vi.fn().mockRejectedValue(failure),
  };
}

function fakeLogger(): TestLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  } as TestLogger;
}

function sequenceClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0;
}
