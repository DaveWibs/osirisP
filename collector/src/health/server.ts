import { createServer, type Server } from "node:http";

import type { Logger } from "pino";

export interface SourceHealth {
  lastCompletedAt: Date | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
  latestStartedAt: Date | null;
  latestStatus: "running" | "succeeded" | "failed" | null;
  runningCount: number;
}

export interface SourceHealthProvider {
  getSourceHealth(sourceId: string): Promise<SourceHealth>;
}

export interface HealthServerOptions {
  host: string;
  logger: Logger;
  port: number;
  provider: SourceHealthProvider;
  sourceIds: string[];
  staleAfterMs: number;
  clock?: () => Date;
}

export function statusForHealth(
  health: SourceHealth,
  now: Date,
  staleAfterMs: number,
): { httpStatus: number; status: string } {
  const latestIsStale =
    health.latestStartedAt !== null &&
    now.getTime() - health.latestStartedAt.getTime() > staleAfterMs;

  if (health.latestStatus === "running") {
    if (latestIsStale) {
      return { httpStatus: 503, status: "stale" };
    }

    return {
      httpStatus: 200,
      status: health.lastSuccessAt === null ? "starting" : "collecting",
    };
  }

  if (health.latestStatus === "failed") {
    return { httpStatus: 503, status: "degraded" };
  }

  if (health.lastSuccessAt === null) {
    return { httpStatus: 200, status: "starting" };
  }

  if (now.getTime() - health.lastSuccessAt.getTime() > staleAfterMs) {
    return { httpStatus: 503, status: "stale" };
  }

  return { httpStatus: 200, status: "healthy" };
}

function aggregateStatus(
  states: Array<{ httpStatus: number; status: string }>,
): { httpStatus: number; status: string } {
  if (states.length === 1) {
    return states[0] ?? { httpStatus: 503, status: "unavailable" };
  }

  // With many independent external feeds, individual sources fail routinely
  // (rate limits, upstream outages). That is a monitoring concern surfaced by
  // /api/v1/operations/alerts, not a collector-liveness failure — so only a
  // total outage (every source unhealthy) fails the aggregate health check
  // that gates deploys and the container healthcheck. A partial failure is
  // reported as "degraded" but still HTTP 200 so the collector stays up.
  const unhealthy = states.filter((state) => state.httpStatus >= 500);
  if (unhealthy.length === states.length) {
    return { httpStatus: 503, status: "unavailable" };
  }

  if (unhealthy.length > 0) {
    return { httpStatus: 200, status: "degraded" };
  }

  if (states.every((state) => state.status === "starting")) {
    return { httpStatus: 200, status: "starting" };
  }

  if (states.some((state) => state.status === "collecting")) {
    return { httpStatus: 200, status: "collecting" };
  }

  return { httpStatus: 200, status: "healthy" };
}

export class CollectorHealthServer {
  private server: Server | null = null;
  private readonly clock: () => Date;

  constructor(private readonly options: HealthServerOptions) {
    if (!Number.isSafeInteger(options.staleAfterMs) || options.staleAfterMs < 1) {
      throw new Error("staleAfterMs must be a positive integer");
    }
    if (options.sourceIds.length === 0) {
      throw new Error("sourceIds must contain at least one source id");
    }

    this.clock = options.clock ?? (() => new Date());
  }

  async listen(): Promise<number> {
    if (this.server !== null) {
      throw new Error("Health server is already listening");
    }

    const server = createServer(async (request, response) => {
      if (request.method !== "GET" || request.url !== "/health") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      try {
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
          throw new Error("Health clock returned an invalid Date");
        }
        const sourceEntries = await Promise.all(
          this.options.sourceIds.map(async (sourceId) => {
            const health = await this.options.provider.getSourceHealth(sourceId);
            const state = statusForHealth(health, now, this.options.staleAfterMs);
            return [sourceId, { health, state }] as const;
          }),
        );
        const state = aggregateStatus(sourceEntries.map(([, entry]) => entry.state));
        const sources = Object.fromEntries(
          sourceEntries.map(([sourceId, entry]) => [
            sourceId,
            {
              status: entry.state.status,
              latestStatus: entry.health.latestStatus,
              latestStartedAt: entry.health.latestStartedAt?.toISOString() ?? null,
              lastSuccessAt: entry.health.lastSuccessAt?.toISOString() ?? null,
              lastCompletedAt: entry.health.lastCompletedAt?.toISOString() ?? null,
              lastErrorAt: entry.health.lastErrorAt?.toISOString() ?? null,
              runningCount: entry.health.runningCount,
            },
          ]),
        );
        const firstSource = sourceEntries[0];
        const firstHealth = firstSource?.[1].health;
        response.writeHead(state.httpStatus, {
          "cache-control": "no-store",
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            service: "osiris-worldstate-collector",
            sourceCount: this.options.sourceIds.length,
            sourceId: this.options.sourceIds.length === 1 ? this.options.sourceIds[0] : null,
            sourceIds: this.options.sourceIds,
            status: state.status,
            sources,
            latestStatus: this.options.sourceIds.length === 1 ? firstHealth?.latestStatus ?? null : null,
            latestStartedAt:
              this.options.sourceIds.length === 1
                ? firstHealth?.latestStartedAt?.toISOString() ?? null
                : null,
            lastSuccessAt:
              this.options.sourceIds.length === 1
                ? firstHealth?.lastSuccessAt?.toISOString() ?? null
                : null,
            lastCompletedAt:
              this.options.sourceIds.length === 1
                ? firstHealth?.lastCompletedAt?.toISOString() ?? null
                : null,
            lastErrorAt:
              this.options.sourceIds.length === 1
                ? firstHealth?.lastErrorAt?.toISOString() ?? null
                : null,
            runningCount:
              this.options.sourceIds.length === 1 ? firstHealth?.runningCount ?? 0 : null,
          }),
        );
      } catch (error) {
        this.options.logger.error({ err: error }, "Collector health query failed");
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            service: "osiris-worldstate-collector",
            status: "unavailable",
          }),
        );
      }
    });

    this.server = server;

    return new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off("error", reject);
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Health server did not expose a TCP address"));
          return;
        }
        resolve(address.port);
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
}
