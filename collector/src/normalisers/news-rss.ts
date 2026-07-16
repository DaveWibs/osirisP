import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const BBC_WORLD_RSS_SOURCE_ID = 'bbc-world-rss' as const;
export const ALJAZEERA_ALL_RSS_SOURCE_ID = 'aljazeera-all-rss' as const;
export const GDACS_NEWS_RSS_SOURCE_ID = 'gdacs-news-rss' as const;

export type NewsRssSourceId =
  | typeof BBC_WORLD_RSS_SOURCE_ID
  | typeof ALJAZEERA_ALL_RSS_SOURCE_ID
  | typeof GDACS_NEWS_RSS_SOURCE_ID;

const SOURCE_METADATA = {
  [BBC_WORLD_RSS_SOURCE_ID]: { provider: 'BBC', feedName: 'BBC World News' },
  [ALJAZEERA_ALL_RSS_SOURCE_ID]: { provider: 'Al Jazeera', feedName: 'Al Jazeera All News' },
  [GDACS_NEWS_RSS_SOURCE_ID]: { provider: 'GDACS', feedName: 'GDACS Alerts RSS' },
} as const;

export interface NormalisedNewsArticle {
  sourceId: NewsRssSourceId;
  sourceArticleId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  publishedAt: Date;
  title: string;
  description: string | null;
  link: string | null;
  provider: string;
  feedName: string;
  contentHash: string;
  evidenceClassification: 'reported';
  rawPayload: unknown;
  metadata: {
    provider: string;
    feedName: string;
    format: 'rss';
    article_content_hash: string;
    stableIdentifierSource: string;
    [key: string]: unknown;
  };
}

export interface NormalisedNewsRssFeed {
  sourceId: NewsRssSourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedNewsArticle[];
}

export class NewsRssNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsRssNormalisationError';
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .trim();
}

function getTag(itemXml: string, tag: string): string {
  const match = itemXml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'iu'));
  return match?.[1] === undefined ? '' : decodeXml(match[1]);
}

function parseDate(value: string | null, fallback: Date, label: string): Date {
  if (value === null || value.trim().length === 0) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new NewsRssNormalisationError(`RSS item has invalid ${label}`);
  }
  return parsed;
}

function latestTimestamp(records: NormalisedNewsArticle[]): Date | null {
  return records.reduce<Date | null>((current, record) => {
    if (current === null || record.sourceUpdatedAt.getTime() > current.getTime()) {
      return record.sourceUpdatedAt;
    }
    return current;
  }, null);
}

export function normaliseNewsRssFeed(
  body: Buffer,
  sourceId: NewsRssSourceId,
  observedAt: Date,
): NormalisedNewsRssFeed {
  if (!Buffer.isBuffer(body)) {
    throw new NewsRssNormalisationError('RSS response body must be a Buffer');
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new NewsRssNormalisationError('observedAt must be a valid Date');
  }

  const xml = body.toString('utf8');
  if (!/<rss[\s>]/iu.test(xml) && !/<rdf:RDF[\s>]/iu.test(xml)) {
    throw new NewsRssNormalisationError('RSS response did not contain an RSS document');
  }

  const source = SOURCE_METADATA[sourceId];
  const records = xml.split(/<item(?:\s[^>]*)?>/iu).slice(1).flatMap((rawItem) => {
    const itemXml = rawItem.split(/<\/item>/iu)[0] ?? '';
    const title = getTag(itemXml, 'title');
    if (title.length === 0) return [];

    const link = getTag(itemXml, 'link') || null;
    const description = getTag(itemXml, 'description') || null;
    const publishedAt = parseDate(getTag(itemXml, 'pubDate') || null, observedAt, 'pubDate');
    const sourceArticleId = link ?? `${title}:${publishedAt.toISOString()}`;
    const rawPayload = itemXml.trim();
    const contentHash = hashText(rawPayload);

    return [{
      sourceId,
      sourceArticleId: hashText(sourceArticleId),
      observedAt: publishedAt,
      sourceUpdatedAt: publishedAt,
      publishedAt,
      title,
      description,
      link,
      provider: source.provider,
      feedName: source.feedName,
      contentHash,
      evidenceClassification: 'reported',
      rawPayload,
      metadata: {
        provider: source.provider,
        feedName: source.feedName,
        format: 'rss',
        article_content_hash: contentHash,
        stableIdentifierSource: link === null ? 'title_published_at_hash' : 'link_hash',
      },
    } satisfies NormalisedNewsArticle];
  });

  return { sourceId, upstreamTimestamp: latestTimestamp(records), records };
}
