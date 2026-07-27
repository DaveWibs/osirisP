/**
 * Live source health check. Fetches every configured upstream and runs its
 * real normaliser against the current response, so upstream format drift (a
 * provider changing or retiring an endpoint, as Yahoo and OpenAQ did) is
 * caught before it silently zeroes a source in production.
 *
 * Opt-in — it makes real network requests and is never part of the unit
 * suite. Run from the collector package:
 *
 *   OPENAQ_API_KEY=... npm run sources:check
 *
 * Exit code is non-zero if any source fails to PARSE (a dev-actionable format
 * drift). Network/HTTP failures are reported but do not fail the run, since
 * they depend on where the check runs from (e.g. IPv6-less hosts, provider
 * rate limits) rather than on the collector code.
 */
import { BoundedHttpFetcher } from '../src/framework/http-fetcher.js';
import { normaliseUsgsEarthquakeFeed } from '../src/normalisers/usgs.js';
import { normaliseGdacsDisasterFeed } from '../src/normalisers/gdacs.js';
import { normaliseNasaFirmsFeed } from '../src/normalisers/nasa-firms.js';
import { normaliseNasaEonetVolcanoFeed } from '../src/normalisers/nasa-eonet.js';
import { normaliseWeatherFeed } from '../src/normalisers/weather.js';
import { normaliseNoaaSpaceWeatherFeed } from '../src/normalisers/noaa-space-weather.js';
import { normaliseThreatIntelFeed } from '../src/normalisers/threat-intel.js';
import { normaliseSatelliteFeed } from '../src/normalisers/satellites.js';
import { normaliseAirQualityFeed } from '../src/normalisers/air-quality.js';
import { normaliseCryptoPriceFeed } from '../src/normalisers/crypto-prices.js';
import { normaliseNewsRssFeed } from '../src/normalisers/news-rss.js';
import { normaliseInternetOutageFeed } from '../src/normalisers/internet-outages.js';
import { iodaOutageEndpoint } from '../src/collectors/internet-outage-sources.js';
import { normaliseAdsbAircraftFeed } from '../src/normalisers/adsb-aircraft.js';

const KEY = process.env.OPENAQ_API_KEY ?? '';
const now = new Date();
const fetcher = new BoundedHttpFetcher({ timeoutMs: 30_000, maxBodyBytes: 40 * 1024 * 1024 });

interface SourceCheck {
  id: string;
  url: string;
  headers?: Record<string, string>;
  run: (body: Buffer) => { records: unknown[] };
}

const checks: SourceCheck[] = [
  { id: 'usgs-earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', run: (b) => normaliseUsgsEarthquakeFeed(b) },
  { id: 'gdacs-disasters', url: 'https://www.gdacs.org/xml/rss.xml', run: (b) => normaliseGdacsDisasterFeed(b) },
  { id: 'gdacs-news-rss', url: 'https://www.gdacs.org/xml/rss.xml', run: (b) => normaliseNewsRssFeed(b, 'gdacs-news-rss', now) },
  { id: 'nasa-firms-viirs', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv', run: (b) => normaliseNasaFirmsFeed(b, 'nasa-firms-viirs') },
  { id: 'nasa-firms-modis', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv', run: (b) => normaliseNasaFirmsFeed(b, 'nasa-firms-modis') },
  { id: 'nasa-eonet-volcanoes', url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50', run: (b) => normaliseNasaEonetVolcanoFeed(b) },
  { id: 'nasa-eonet-weather', url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100', run: (b) => normaliseWeatherFeed(b, 'nasa-eonet-weather') },
  { id: 'noaa-nws-alerts', url: 'https://api.weather.gov/alerts/active?status=actual&message_type=alert', run: (b) => normaliseWeatherFeed(b, 'noaa-nws-alerts') },
  { id: 'noaa-swpc-planetary-k-index', url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', run: (b) => normaliseNoaaSpaceWeatherFeed(b, 'noaa-swpc-planetary-k-index') },
  { id: 'noaa-swpc-alerts', url: 'https://services.swpc.noaa.gov/products/alerts.json', run: (b) => normaliseNoaaSpaceWeatherFeed(b, 'noaa-swpc-alerts') },
  { id: 'noaa-swpc-xray-flares', url: 'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', run: (b) => normaliseNoaaSpaceWeatherFeed(b, 'noaa-swpc-xray-flares') },
  { id: 'abusech-feodo-ipblocklist', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json', run: (b) => normaliseThreatIntelFeed(b, 'abusech-feodo-ipblocklist') },
  { id: 'abusech-urlhaus-online', url: 'https://urlhaus.abuse.ch/downloads/csv_online/', run: (b) => normaliseThreatIntelFeed(b, 'abusech-urlhaus-online') },
  { id: 'cisa-known-exploited-vulnerabilities', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', run: (b) => normaliseThreatIntelFeed(b, 'cisa-known-exploited-vulnerabilities') },
  { id: 'celestrak-active-tle', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', run: (b) => normaliseSatelliteFeed(b, 'celestrak-active-tle') },
  { id: 'celestrak-starlink-supplemental-tle', url: 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle', run: (b) => normaliseSatelliteFeed(b, 'celestrak-starlink-supplemental-tle') },
  { id: 'satnogs-tle', url: 'https://db.satnogs.org/api/tle/?format=json', run: (b) => normaliseSatelliteFeed(b, 'satnogs-tle') },
  { id: 'openaq-latest-pm25', url: 'https://api.openaq.org/v3/parameters/2/latest?limit=1000', headers: KEY.length > 0 ? { 'x-api-key': KEY } : undefined, run: (b) => normaliseAirQualityFeed(b) },
  { id: 'coingecko-simple-price', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd', run: (b) => normaliseCryptoPriceFeed(b, now) },
  { id: 'bbc-world-rss', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', run: (b) => normaliseNewsRssFeed(b, 'bbc-world-rss', now) },
  { id: 'aljazeera-all-rss', url: 'https://www.aljazeera.com/xml/rss/all.xml', run: (b) => normaliseNewsRssFeed(b, 'aljazeera-all-rss', now) },
  { id: 'gatech-ioda-outages', url: iodaOutageEndpoint(new URL('https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&limit=200'), now).toString(), run: (b) => normaliseInternetOutageFeed(b, now) },
  { id: 'airplanes-live-military', url: 'https://api.airplanes.live/v2/mil', run: (b) => normaliseAdsbAircraftFeed(b, 'airplanes-live-military', now) },
  { id: 'adsb-lol-military', url: 'https://api.adsb.lol/v2/mil', run: (b) => normaliseAdsbAircraftFeed(b, 'adsb-lol-military', now) },
];

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + ' '.repeat(width - value.length);

let parseFailures = 0;
let network = 0;
let ok = 0;

for (const check of checks) {
  try {
    const response = await fetcher.fetch(check.url, undefined, check.headers);
    if (response.status < 200 || response.status > 299) {
      console.log(pad(check.id, 38), `HTTP ${response.status}  (network/provider)`);
      network += 1;
      continue;
    }
    let feed: { records: unknown[] };
    try {
      feed = check.run(response.body);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.log(pad(check.id, 38), `PARSE FAIL  ${message.slice(0, 70)}`);
      parseFailures += 1;
      continue;
    }
    console.log(pad(check.id, 38), `ok  records=${feed.records.length}`);
    ok += 1;
  } catch (networkError) {
    const cause =
      networkError instanceof Error &&
      networkError.cause !== null &&
      typeof networkError.cause === 'object' &&
      'code' in networkError.cause
        ? ` / ${String((networkError.cause as { code?: string }).code)}`
        : '';
    const message = networkError instanceof Error ? networkError.message : String(networkError);
    console.log(pad(check.id, 38), `NETWORK  ${message.slice(0, 40)}${cause}  (env-dependent)`);
    network += 1;
  }
}

console.log(
  `\n${ok} parsed ok, ${parseFailures} parse failures, ${network} network/provider.` +
    ' yahoo-finance-market-quotes is served by the internal sidecar and is not checked here.',
);

if (parseFailures > 0) {
  process.exitCode = 1;
}
