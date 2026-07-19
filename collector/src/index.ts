import { setDefaultResultOrder } from "node:dns";

import { AdsbAircraftCollector } from "./collectors/adsb-aircraft-sources.js";
import { AirQualityCollector } from "./collectors/air-quality-sources.js";
import { CryptoPriceCollector } from "./collectors/crypto-price-sources.js";
import { GdacsDisasterCollector } from "./collectors/gdacs-disasters.js";
import { InternetOutageCollector } from "./collectors/internet-outage-sources.js";
import { MarketQuoteCollector } from "./collectors/market-quote-sources.js";
import { NasaEonetVolcanoCollector, NasaFirmsCollector } from "./collectors/nasa-fire-sources.js";
import { NewsRssCollector } from "./collectors/news-rss-sources.js";
import { NoaaSpaceWeatherCollector } from "./collectors/noaa-space-weather.js";
import { SatelliteCollector } from "./collectors/satellite-sources.js";
import { ThreatIntelCollector } from "./collectors/threat-intel-sources.js";
import { UsgsEarthquakeCollector } from "./collectors/usgs-earthquakes.js";
import { WeatherCollector } from "./collectors/weather-sources.js";
import { type CollectorSourceId, loadConfig } from "./config.js";
import { runCollectionCycle } from "./framework/collection-cycle.js";
import { toSafeError } from "./framework/errors.js";
import { BoundedHttpFetcher } from "./framework/http-fetcher.js";
import { SerialPollingScheduler } from "./framework/scheduler.js";
import { CollectorHealthServer } from "./health/server.js";
import { createLogger } from "./logger.js";
import { ArchiveWriter } from "./storage/archive-writer.js";
import { PostgresStore } from "./storage/postgres-store.js";

type ConfiguredCollector = {
  readonly sourceId: string;
  collect(signal?: AbortSignal): Promise<unknown>;
};

// Node's fetch tries AAAA results first; on hosts without a working IPv6
// route every dual-stack source (NASA EONET/FIRMS, adsb.lol, SatNOGS, …)
// fails with a bare "fetch failed" while IPv4-only sources keep working.
// Prefer A records so collection succeeds wherever IPv4 does.
setDefaultResultOrder("ipv4first");

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const store = new PostgresStore(config.databaseConfig);
  const archiveWriter = new ArchiveWriter(config.archiveRoot);
  const fetcher = new BoundedHttpFetcher({
    maxBodyBytes: config.maxResponseBytes,
    timeoutMs: config.requestTimeoutMs,
  });
  const commonCollectorOptions = {
    archiveWriter,
    fetcher,
    logger,
    maxAttempts: config.maxFetchAttempts,
    retryBaseMs: config.retryBaseMs,
    staleRunAfterMs: config.staleRunAfterMs,
    store,
  };

  const createCollector = (sourceId: CollectorSourceId): ConfiguredCollector => {
    switch (sourceId) {
      case "abusech-feodo-ipblocklist":
        return new ThreatIntelCollector({
          ...commonCollectorOptions,
          endpoint: config.feodoEndpoint,
          sourceId,
        });
      case "abusech-urlhaus-online":
        return new ThreatIntelCollector({
          ...commonCollectorOptions,
          endpoint: config.urlhausEndpoint,
          sourceId,
        });
      case "adsb-lol-military":
        return new AdsbAircraftCollector({
          ...commonCollectorOptions,
          endpoint: config.adsbLolMilitaryEndpoint,
          sourceId,
        });
      case "airplanes-live-military":
        return new AdsbAircraftCollector({
          ...commonCollectorOptions,
          endpoint: config.airplanesLiveMilitaryEndpoint,
          sourceId,
        });
      case "aljazeera-all-rss":
        return new NewsRssCollector({
          ...commonCollectorOptions,
          endpoint: config.aljazeeraAllRssEndpoint,
          sourceId,
        });
      case "bbc-world-rss":
        return new NewsRssCollector({
          ...commonCollectorOptions,
          endpoint: config.bbcWorldRssEndpoint,
          sourceId,
        });
      case "celestrak-active-tle":
        return new SatelliteCollector({
          ...commonCollectorOptions,
          endpoint: config.celestrakActiveTleEndpoint,
          sourceId,
        });
      case "celestrak-starlink-supplemental-tle":
        return new SatelliteCollector({
          ...commonCollectorOptions,
          endpoint: config.celestrakStarlinkTleEndpoint,
          sourceId,
        });
      case "cisa-known-exploited-vulnerabilities":
        return new ThreatIntelCollector({
          ...commonCollectorOptions,
          endpoint: config.cisaKevEndpoint,
          sourceId,
        });
      case "coingecko-simple-price":
        return new CryptoPriceCollector({
          ...commonCollectorOptions,
          endpoint: config.coinGeckoSimplePriceEndpoint,
          sourceId,
        });
      case "gatech-ioda-outages":
        return new InternetOutageCollector({
          ...commonCollectorOptions,
          endpoint: config.iodaOutagesEndpoint,
          sourceId,
        });
      case "gdacs-disasters":
        return new GdacsDisasterCollector({
          ...commonCollectorOptions,
          endpoint: config.gdacsEndpoint,
        });
      case "gdacs-news-rss":
        return new NewsRssCollector({
          ...commonCollectorOptions,
          endpoint: config.gdacsNewsRssEndpoint,
          sourceId,
        });
      case "nasa-eonet-volcanoes":
        return new NasaEonetVolcanoCollector({
          ...commonCollectorOptions,
          endpoint: config.eonetVolcanoesEndpoint,
        });
      case "nasa-eonet-weather":
        return new WeatherCollector({
          ...commonCollectorOptions,
          endpoint: config.eonetWeatherEndpoint,
          sourceId,
        });
      case "nasa-firms-modis":
        return new NasaFirmsCollector({
          ...commonCollectorOptions,
          endpoint: config.firmsModisEndpoint,
          sourceId,
        });
      case "nasa-firms-viirs":
        return new NasaFirmsCollector({
          ...commonCollectorOptions,
          endpoint: config.firmsViirsEndpoint,
          sourceId,
        });
      case "noaa-nws-alerts":
        return new WeatherCollector({
          ...commonCollectorOptions,
          endpoint: config.nwsAlertsEndpoint,
          sourceId,
        });
      case "noaa-swpc-alerts":
        return new NoaaSpaceWeatherCollector({
          ...commonCollectorOptions,
          endpoint: config.swpcAlertsEndpoint,
          sourceId,
        });
      case "noaa-swpc-planetary-k-index":
        return new NoaaSpaceWeatherCollector({
          ...commonCollectorOptions,
          endpoint: config.swpcKpEndpoint,
          sourceId,
        });
      case "noaa-swpc-xray-flares":
        return new NoaaSpaceWeatherCollector({
          ...commonCollectorOptions,
          endpoint: config.swpcXrayFlaresEndpoint,
          sourceId,
        });
      case "openaq-latest-pm25":
        return new AirQualityCollector({
          ...commonCollectorOptions,
          endpoint: config.openAqPm25Endpoint,
          apiKey: config.openAqApiKey,
          sourceId,
        });
      case "satnogs-tle":
        return new SatelliteCollector({
          ...commonCollectorOptions,
          endpoint: config.satnogsTleEndpoint,
          sourceId,
        });
      case "usgs-earthquakes":
        return new UsgsEarthquakeCollector({
          ...commonCollectorOptions,
          endpoint: config.usgsEndpoint,
        });
      case "yahoo-finance-market-quotes":
        return new MarketQuoteCollector({
          ...commonCollectorOptions,
          endpoint: config.yahooMarketQuotesEndpoint,
          sourceId,
        });
    }
  };

  const collectors = config.collectorSources.map((sourceId) => createCollector(sourceId));
  const sourceIds = collectors.map((collector) => collector.sourceId);

  const collectConfiguredSources = async (signal?: AbortSignal): Promise<void> => {
    await runCollectionCycle({ collectors, logger, signal, sourceIds });
  };

  if (config.collectOnce) {
    try {
      await collectConfiguredSources();
    } finally {
      await store.close();
    }
    return;
  }

  const healthServer = new CollectorHealthServer({
    host: config.healthHost,
    logger,
    port: config.healthPort,
    provider: store,
    sourceIds,
    staleAfterMs: config.staleRunAfterMs,
  });
  const scheduler = new SerialPollingScheduler({
    intervalMs: config.collectIntervalMs,
    onError: (error) => {
      logger.error(
        { error: toSafeError(error), sourceCount: collectors.length, sourceIds },
        "Scheduled collection failed",
      );
    },
    task: async (signal) => {
      await collectConfiguredSources(signal);
    },
  });

  let healthListening = false;

  try {
    await healthServer.listen();
    healthListening = true;
    scheduler.start(config.collectOnStartup);
    logger.info(
      {
        collectIntervalMs: config.collectIntervalMs,
        healthPort: config.healthPort,
        sourceCount: collectors.length,
        sourceIds,
      },
      "World-State collector started",
    );

    await new Promise<void>((resolve) => {
      let shuttingDown = false;
      const shutdown = (signal: string) => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        logger.info({ signal }, "Stopping World-State collector");
        resolve();
      };

      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    });
  } finally {
    await scheduler.stop();
    if (healthListening) {
      await healthServer.close();
    }
    await store.close();
  }
}

run().catch((error: unknown) => {
  const safe = toSafeError(error);
  process.stderr.write(
    `${JSON.stringify({ level: "fatal", service: "osiris-worldstate-collector", error: safe })}\n`,
  );
  process.exitCode = 1;
});
