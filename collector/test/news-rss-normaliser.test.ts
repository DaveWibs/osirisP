import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ALJAZEERA_ALL_RSS_SOURCE_ID,
  BBC_WORLD_RSS_SOURCE_ID,
  GDACS_NEWS_RSS_SOURCE_ID,
  NewsRssNormalisationError,
  normaliseNewsRssFeed,
} from '../src/normalisers/news-rss.js';

let bbcFixture: Buffer;
let aljazeeraFixture: Buffer;
let gdacsFixture: Buffer;
const observedAt = new Date('2026-01-01T00:00:01.000Z');

beforeAll(async () => {
  bbcFixture = await readFile(new URL('./fixtures/bbc-world-rss.xml', import.meta.url));
  aljazeeraFixture = await readFile(new URL('./fixtures/aljazeera-all-rss.xml', import.meta.url));
  gdacsFixture = await readFile(new URL('./fixtures/gdacs-news-rss.xml', import.meta.url));
});

describe('normaliseNewsRssFeed', () => {
  it('normalises BBC World RSS items with stable article identifiers', () => {
    const result = normaliseNewsRssFeed(bbcFixture, BBC_WORLD_RSS_SOURCE_ID, observedAt);

    expect(result.sourceId).toBe(BBC_WORLD_RSS_SOURCE_ID);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:20:00.000Z');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      title: 'Global leaders meet for emergency talks',
      description: 'Diplomats gather after a week of escalating regional pressure.',
      link: 'https://www.bbc.com/news/world-fixture-1',
      provider: 'BBC',
      feedName: 'BBC World News',
      evidenceClassification: 'reported',
      metadata: {
        provider: 'BBC',
        feedName: 'BBC World News',
        format: 'rss',
        stableIdentifierSource: 'link_hash',
      },
    });
    expect(result.records[0]?.sourceArticleId).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.records[0]?.metadata.article_content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.records[1]?.description).toBe('Relief agencies report & verify renewed access.');
  });

  it('applies source-specific provider metadata for Al Jazeera and GDACS', () => {
    expect(
      normaliseNewsRssFeed(aljazeeraFixture, ALJAZEERA_ALL_RSS_SOURCE_ID, observedAt).records[0],
    ).toMatchObject({
      provider: 'Al Jazeera',
      feedName: 'Al Jazeera All News',
      publishedAt: new Date('2026-01-01T01:00:00.000Z'),
    });

    expect(
      normaliseNewsRssFeed(gdacsFixture, GDACS_NEWS_RSS_SOURCE_ID, observedAt).records[0],
    ).toMatchObject({
      provider: 'GDACS',
      feedName: 'GDACS Alerts RSS',
      link: 'https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1234567',
    });
  });

  it('rejects invalid RSS bodies and invalid item dates', () => {
    expect(() =>
      normaliseNewsRssFeed(Buffer.from('{"items":[]}'), BBC_WORLD_RSS_SOURCE_ID, observedAt),
    ).toThrow(NewsRssNormalisationError);

    expect(() =>
      normaliseNewsRssFeed(
        Buffer.from('<rss><channel><item><title>Bad date</title><pubDate>bad</pubDate></item></channel></rss>'),
        BBC_WORLD_RSS_SOURCE_ID,
        observedAt,
      ),
    ).toThrow(NewsRssNormalisationError);
  });
});
