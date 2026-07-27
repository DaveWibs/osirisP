import { z } from 'zod';

import { toSafeError } from '../framework/errors.js';
import type { BoundedHttpFetcher } from '../framework/http-fetcher.js';
import type { NormalisedAirQualityRecord } from '../normalisers/air-quality.js';
import type { Logger } from 'pino';

/**
 * Enriches OpenAQ v3 pm2.5 records with the station's real country, name and
 * locality. The v3 latest feed only carries locationsId/sensorsId (unlike the
 * retired v2 feed, which embedded location metadata inline), so this resolves
 * the missing fields from the /v3/locations catalogue.
 *
 * The catalogue is large, so lookups are bounded: at most `maxLookupsPerCycle`
 * previously-unseen locations are fetched per collection cycle and cached
 * indefinitely in memory. Unresolved stations keep the normaliser's placeholder
 * (country "ZZ", synthetic name) and are retried on a later cycle. Enrichment
 * is strictly best-effort and never throws — a lookup failure leaves the
 * placeholder in place rather than failing the collection run.
 */

const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/u;

const locationResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            id: z.number(),
            name: z.string().nullable().optional(),
            locality: z.string().nullable().optional(),
            country: z
              .object({ code: z.string().nullable().optional() })
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

interface ResolvedLocation {
  countryCode: string;
  name: string | null;
  locality: string | null;
}

export interface OpenAqLocationFetcher {
  fetch(
    endpoint: string | URL,
    signal?: AbortSignal,
    requestHeaders?: Record<string, string>,
  ): ReturnType<BoundedHttpFetcher['fetch']>;
}

export interface OpenAqLocationResolverOptions {
  fetcher: OpenAqLocationFetcher;
  logger: Logger;
  apiKey?: string;
  baseUrl?: string;
  maxLookupsPerCycle?: number;
}

const DEFAULT_BASE_URL = 'https://api.openaq.org/v3/locations';
const DEFAULT_MAX_LOOKUPS_PER_CYCLE = 40;

function locationIdOf(record: NormalisedAirQualityRecord): number | null {
  const value = record.metadata.location_id;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export class OpenAqLocationResolver {
  private readonly cache = new Map<number, ResolvedLocation>();
  private readonly fetcher: OpenAqLocationFetcher;
  private readonly logger: Logger;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxLookupsPerCycle: number;

  constructor(options: OpenAqLocationResolverOptions) {
    this.fetcher = options.fetcher;
    this.logger = options.logger;
    this.apiKey = options.apiKey ?? '';
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.maxLookupsPerCycle = options.maxLookupsPerCycle ?? DEFAULT_MAX_LOOKUPS_PER_CYCLE;
  }

  /**
   * Fills country, name and locality on records whose station is known (or can
   * be looked up this cycle). Mutates and returns the same array. Records whose
   * location cannot be resolved are left with their placeholder values.
   */
  async enrich(
    records: NormalisedAirQualityRecord[],
    signal?: AbortSignal,
  ): Promise<NormalisedAirQualityRecord[]> {
    const pending: number[] = [];
    for (const record of records) {
      const locationId = locationIdOf(record);
      if (locationId !== null && !this.cache.has(locationId) && !pending.includes(locationId)) {
        pending.push(locationId);
      }
    }

    for (const locationId of pending.slice(0, this.maxLookupsPerCycle)) {
      const resolved = await this.lookup(locationId, signal);
      if (resolved !== null) {
        this.cache.set(locationId, resolved);
      }
    }

    for (const record of records) {
      const locationId = locationIdOf(record);
      const resolved = locationId === null ? undefined : this.cache.get(locationId);
      if (resolved === undefined) continue;
      record.countryCode = resolved.countryCode;
      if (resolved.name !== null) record.locationName = resolved.name;
      record.city = resolved.locality;
      record.metadata.sourceName = resolved.name;
    }

    return records;
  }

  private async lookup(locationId: number, signal?: AbortSignal): Promise<ResolvedLocation | null> {
    const endpoint = `${this.baseUrl}/${locationId}`;
    try {
      const response = await this.fetcher.fetch(
        endpoint,
        signal,
        this.apiKey.length > 0 ? { 'x-api-key': this.apiKey } : undefined,
      );
      if (response.status < 200 || response.status > 299) {
        return null;
      }
      const parsed = locationResponseSchema.safeParse(
        JSON.parse(response.body.toString('utf8')) as unknown,
      );
      if (!parsed.success) return null;
      const result = parsed.data.results[0];
      if (result === undefined) return null;
      const code = result.country?.code ?? null;
      return {
        countryCode: code !== null && COUNTRY_CODE_PATTERN.test(code) ? code.toUpperCase() : 'ZZ',
        name: result.name ?? null,
        locality: result.locality ?? null,
      };
    } catch (error) {
      this.logger.debug(
        { locationId, error: toSafeError(error) },
        'OpenAQ location enrichment lookup failed; keeping placeholder',
      );
      return null;
    }
  }
}
