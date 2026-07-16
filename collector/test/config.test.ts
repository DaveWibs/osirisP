import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://osiris:local-test@127.0.0.1:5432/osiris_test",
  RAW_ARCHIVE_PATH: "/tmp/osiris-archive",
};

describe("loadConfig", () => {
  it("loads bounded defaults without exposing credentials", () => {
    const config = loadConfig(requiredEnvironment);

    expect(config.collectIntervalMs).toBe(300_000);
    expect(config.collectorSource).toBe("usgs-earthquakes");
    expect(config.collectorSources).toEqual(["usgs-earthquakes"]);
    expect(config.maxFetchAttempts).toBe(3);
    expect(config.maxResponseBytes).toBe(25 * 1024 * 1024);
    expect(config.usgsEndpoint.hostname).toBe("earthquake.usgs.gov");
    expect(config.celestrakActiveTleEndpoint.hostname).toBe("celestrak.org");
    expect(config.celestrakStarlinkTleEndpoint.hostname).toBe("celestrak.org");
    expect(config.satnogsTleEndpoint.hostname).toBe("db.satnogs.org");
    expect(config.openAqPm25Endpoint.hostname).toBe("api.openaq.org");
    expect(config.coinGeckoSimplePriceEndpoint.hostname).toBe("api.coingecko.com");
    expect(config.bbcWorldRssEndpoint.hostname).toBe("feeds.bbci.co.uk");
    expect(config.aljazeeraAllRssEndpoint.hostname).toBe("www.aljazeera.com");
    expect(config.gdacsNewsRssEndpoint.hostname).toBe("www.gdacs.org");
    expect(config.iodaOutagesEndpoint.hostname).toBe("api.ioda.inetintel.cc.gatech.edu");
    expect(config.yahooMarketQuotesEndpoint.hostname).toBe("query2.finance.yahoo.com");
    expect(config.airplanesLiveMilitaryEndpoint.hostname).toBe("api.airplanes.live");
    expect(config.adsbLolMilitaryEndpoint.hostname).toBe("api.adsb.lol");
    expect(config.databaseConfig).toMatchObject({
      connectionString: requiredEnvironment.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
      lock_timeout: 5_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
  });

  it("coerces supported booleans and numeric bounds", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      COLLECT_ON_STARTUP: "false",
      COLLECT_ONCE: "1",
      MAX_FETCH_ATTEMPTS: "5",
    });

    expect(config.collectOnStartup).toBe(false);
    expect(config.collectOnce).toBe(true);
    expect(config.maxFetchAttempts).toBe(5);
  });

  it("loads comma-separated collector source sets and removes duplicates", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      COLLECTOR_SOURCE: "usgs-earthquakes",
      COLLECTOR_SOURCES:
        "usgs-earthquakes, gdacs-disasters, usgs-earthquakes, adsb-lol-military",
    });

    expect(config.collectorSource).toBe("usgs-earthquakes");
    expect(config.collectorSources).toEqual([
      "usgs-earthquakes",
      "gdacs-disasters",
      "adsb-lol-military",
    ]);
  });

  it("loads the full collector source set with COLLECTOR_SOURCES=all", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      COLLECTOR_SOURCES: "all",
    });

    expect(config.collectorSource).toBe("usgs-earthquakes");
    expect(config.collectorSources.length).toBeGreaterThan(20);
    expect(config.collectorSources).toContain("airplanes-live-military");
    expect(config.collectorSources).toContain("adsb-lol-military");
  });

  it("rejects empty or unsupported collector source sets", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        COLLECTOR_SOURCES: ",,,",
      }),
    ).toThrow("at least one source");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        COLLECTOR_SOURCES: "usgs-earthquakes,unknown-source",
      }),
    ).toThrow("unsupported source id: unknown-source");
  });

  it("rejects non-PostgreSQL database URLs and relative archive paths", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: "https://example.test/database",
      }),
    ).toThrow("postgres or postgresql");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        RAW_ARCHIVE_PATH: "../archive",
      }),
    ).toThrow("must be absolute");
  });

  it("rejects opaque or incomplete PostgreSQL URLs", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: "postgres:foo",
      }),
    ).toThrow("host and database name");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: "postgresql://db/osiris_test",
      }),
    ).toThrow("explicit username and password");
  });

  it("accepts discrete PostgreSQL settings without URL-encoding the password", () => {
    const config = loadConfig({
      PGDATABASE: "osiris_worldstate",
      PGHOST: "db",
      PGPASSWORD: "a/b#c%d@strong",
      PGPORT: "5432",
      PGUSER: "osiris",
      RAW_ARCHIVE_PATH: "/archive",
    });

    expect(config.databaseConfig).toMatchObject({
      database: "osiris_worldstate",
      host: "db",
      password: "a/b#c%d@strong",
      port: 5432,
      user: "osiris",
    });
    expect(config.databaseConfig).not.toHaveProperty("connectionString");
  });

  it("requires a complete discrete PostgreSQL configuration when DATABASE_URL is absent", () => {
    expect(() =>
      loadConfig({
        PGDATABASE: "osiris_worldstate",
        PGHOST: "db",
        PGUSER: "osiris",
        RAW_ARCHIVE_PATH: "/archive",
      }),
    ).toThrow("missing: PGPASSWORD, PGPORT");
  });

  it("rejects endpoint overrides outside the official USGS HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        USGS_EARTHQUAKE_URL: "https://example.test/feed.geojson",
      }),
    ).toThrow("earthquake.usgs.gov");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        USGS_EARTHQUAKE_URL: "http://earthquake.usgs.gov/feed.geojson",
      }),
    ).toThrow("must use HTTPS");
  });

  it("rejects satellite endpoint overrides outside official HTTPS hosts", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        CELESTRAK_ACTIVE_TLE_URL: "https://example.test/NORAD/elements/gp.php",
      }),
    ).toThrow("celestrak.org");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        SATNOGS_TLE_URL: "http://db.satnogs.org/api/tle/",
      }),
    ).toThrow("must use HTTPS");
  });

  it("rejects OpenAQ endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        OPENAQ_PM25_URL: "https://example.test/v2/latest",
      }),
    ).toThrow("api.openaq.org");
  });

  it("rejects CoinGecko endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        COINGECKO_SIMPLE_PRICE_URL: "https://example.test/api/v3/simple/price",
      }),
    ).toThrow("api.coingecko.com");
  });

  it("rejects news RSS endpoint overrides outside official HTTPS hosts", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        BBC_WORLD_RSS_URL: "https://example.test/news/world/rss.xml",
      }),
    ).toThrow("feeds.bbci.co.uk");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        ALJAZEERA_ALL_RSS_URL: "http://www.aljazeera.com/xml/rss/all.xml",
      }),
    ).toThrow("must use HTTPS");

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        GDACS_NEWS_RSS_URL: "https://example.test/xml/rss.xml",
      }),
    ).toThrow("www.gdacs.org");
  });

  it("rejects IODA endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        IODA_OUTAGES_URL: "https://example.test/v2/outages/events",
      }),
    ).toThrow("api.ioda.inetintel.cc.gatech.edu");
  });

  it("rejects Yahoo Finance market quote endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        YAHOO_MARKET_QUOTES_URL: "https://example.test/v6/finance/quote",
      }),
    ).toThrow("query2.finance.yahoo.com");
  });

  it("rejects airplanes.live endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        AIRPLANES_LIVE_MILITARY_URL: "https://example.test/v2/mil",
      }),
    ).toThrow("api.airplanes.live");
  });

  it("rejects adsb.lol endpoint overrides outside the official HTTPS host", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        ADSB_LOL_MILITARY_URL: "https://example.test/v2/mil",
      }),
    ).toThrow("api.adsb.lol");
  });
});
