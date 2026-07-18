import { describe, expect, it } from 'vitest';

import { FakePersistedExecutor } from '@/lib/persisted/test-executor';
import { NEWS_SOURCE_IDS, buildNewsResponse, loadNewsDatabaseResult } from './persisted';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('loadNewsDatabaseResult', () => {
  it('queries the three persisted RSS sources with the configured window', async () => {
    const executor = new FakePersistedExecutor([{
      response_received_at: '2026-07-18T11:55:00Z',
      upstream_timestamp: '2026-07-18T11:50:00Z',
      title: 'Ceasefire talks continue',
      description: 'Ceasefire negotiations in the region continue amid tension.',
      link: 'https://example.test/article',
      published_at: '2026-07-18T11:40:00Z',
      feed_name: 'BBC World News',
    }]);

    const result = await loadNewsDatabaseResult(900_000, executor);

    expect(executor.calls[0]?.values).toEqual([NEWS_SOURCE_IDS, '900000 milliseconds']);
    expect(executor.calls[0]?.queryText).toContain('news_article_observations');
    expect(result?.responseReceivedAt?.toISOString()).toBe('2026-07-18T11:55:00.000Z');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({ title: 'Ceasefire talks continue', feedName: 'BBC World News' });
  });

  it('returns null when the database is unconfigured and skips null article rows', async () => {
    expect(await loadNewsDatabaseResult(900_000, null)).toBeNull();

    const executor = new FakePersistedExecutor([{
      response_received_at: '2026-07-18T11:55:00Z',
      upstream_timestamp: null,
      title: null,
      description: null,
      link: null,
      published_at: null,
      feed_name: null,
    }]);
    const result = await loadNewsDatabaseResult(900_000, executor);
    expect(result?.rows).toEqual([]);
    expect(result?.responseReceivedAt).not.toBeNull();
  });
});

describe('buildNewsResponse', () => {
  it('produces the live item contract with risk scoring and keyword coordinates', () => {
    const response = buildNewsResponse([
      {
        title: 'Missile strike reported in Ukraine',
        description: 'A missile strike and drone attack were reported near Kyiv.',
        link: 'https://example.test/strike',
        published: new Date('2026-07-18T11:00:00Z'),
        feedName: 'BBC World News',
      },
      {
        title: 'Local festival opens',
        description: 'A cultural festival opened this weekend.',
        link: 'https://example.test/festival',
        published: new Date('2026-07-18T11:30:00Z'),
        feedName: 'Al Jazeera All News',
      },
    ], NOW);

    expect(response.total).toBe(2);
    expect(response.timestamp).toBe('2026-07-18T12:00:00.000Z');
    // Sorted newest first.
    expect(response.news[0].source).toBe('Al Jazeera All News');

    const strike = response.news[1];
    expect(strike.risk_score).toBeGreaterThanOrEqual(8);
    expect(strike.coords).not.toBeNull();
    expect(strike.coords_default).toBe(false);
    expect(strike.machine_assessment).not.toBeNull();
    expect(strike.id).toMatch(/^[0-9a-f]{32}$/);

    const festival = response.news[0];
    expect(festival.risk_score).toBe(1);
    expect(festival.coords).toBeNull();
    expect(festival.coords_default).toBe(true);
    expect(festival.machine_assessment).toBeNull();
  });
});
