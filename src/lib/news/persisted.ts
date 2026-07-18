import crypto from 'node:crypto';
import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';
import { findCoords, scoreRisk } from './analysis';

export const NEWS_SOURCE_IDS = ['bbc-world-rss', 'aljazeera-all-rss', 'gdacs-news-rss'];
const MAX_ARTICLES = 60;

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  link: string;
  published: string;
  source: string;
  risk_score: number;
  coords: [number, number] | null;
  coords_default: boolean;
  machine_assessment: string | null;
}

export interface NewsResponse {
  news: NewsItem[];
  total: number;
  timestamp: string;
}

const DATABASE_QUERY = `
WITH latest_per_source AS (
  SELECT DISTINCT ON (source_id)
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = ANY($1)
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY source_id, response_received_at DESC, id DESC
),
latest_success AS (
  SELECT
    MAX(response_received_at) AS response_received_at,
    MAX(upstream_timestamp) AS upstream_timestamp
  FROM latest_per_source
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  article.title,
  article.description,
  article.link,
  article.published_at,
  article.feed_name
FROM latest_success
LEFT JOIN LATERAL (
  SELECT title, description, link, published_at, feed_name
  FROM news_article_observations
  WHERE observed_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY published_at DESC
  LIMIT ${MAX_ARTICLES}
) AS article ON TRUE`;

interface NewsRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  title: string | null;
  description: string | null;
  link: string | null;
  published_at: Date | string | null;
  feed_name: string | null;
}

export interface PersistedNewsArticle {
  title: string;
  description: string;
  link: string;
  published: Date;
  feedName: string;
}

export function buildNewsResponse(articles: PersistedNewsArticle[], now: Date): NewsResponse {
  const news = articles.map((article) => {
    const riskScore = scoreRisk(article.description || article.title);
    const coords = findCoords(article.description || article.title);
    return {
      id: crypto.createHash('md5').update(article.link + article.published.toISOString()).digest('hex'),
      title: article.title,
      description: article.description,
      link: article.link,
      published: article.published.toISOString(),
      source: article.feedName,
      risk_score: riskScore,
      coords,
      coords_default: coords === null,
      machine_assessment: riskScore >= 8
        ? 'AI Analysis indicates elevated tactical priority based on OSINT stream patterns.'
        : null,
    };
  });

  news.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
  return { news, total: news.length, timestamp: now.toISOString() };
}

function mapRow(row: NewsRow): PersistedNewsArticle | null {
  if (row.title === null || row.feed_name === null) return null;
  const published = parsePersistedTimestamp(row.published_at, 'published_at');
  if (published === null) return null;
  return {
    title: row.title,
    description: row.description ?? '',
    link: row.link ?? '',
    published,
    feedName: row.feed_name,
  };
}

export async function loadNewsDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('news', 'osiris-news-api'),
): Promise<PersistedDatabaseResult<PersistedNewsArticle[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<NewsRow>(DATABASE_QUERY, [
    NEWS_SOURCE_IDS,
    `${windowMs} milliseconds`,
  ]);
  return {
    rows: result.rows.flatMap((row) => {
      const mapped = mapRow(row);
      return mapped === null ? [] : [mapped];
    }),
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}
