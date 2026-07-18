import { NextResponse } from 'next/server';
import crypto from 'crypto';

import { findCoords, scoreRisk } from '@/lib/news/analysis';
import { buildNewsResponse, loadNewsDatabaseResult, type NewsResponse } from '@/lib/news/persisted';
import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
} from '@/lib/persisted/service';

/**
 * OSIRIS — Military-Grade Intelligence API
 * Fetches Telegram OSINT feeds directly, with a failsafe fallback
 * to traditional intelligence sources if Telegram blocks the IP.
 * NEWS_DATA_MODE selects live scraping or the persisted World-State
 * RSS capture (BBC / Al Jazeera / GDACS) with the same item contract.
 */

export const runtime = 'nodejs';

const SUCCESS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=120';

const TELEGRAM_CHANNELS = [
  'OSINTtechnical',
  'Faytuks',
  'Liveuamap',
  'CyberKnow'
];

const FALLBACK_FEEDS = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  GDACS: 'https://www.gdacs.org/xml/rss.xml'
};

interface LiveArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function parseTelegramHTML(html: string, channel: string): LiveArticle[] {
  const items: LiveArticle[] = [];
  const messageBlockRegex = /<div class="tgme_widget_message_wrap js-widget_message_wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
  let blockMatch;

  while ((blockMatch = messageBlockRegex.exec(html)) !== null) {
    const blockHtml = blockMatch[0];
    const textRegex = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i;
    const textMatch = blockHtml.match(textRegex);
    if (!textMatch) continue;

    const text = textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    if (!text || text.length < 10) continue;

    const dateRegex = /<a class="tgme_widget_message_date" href="(https:\/\/t\.me\/[^"]+)".*?<time datetime="([^"]+)"/i;
    const dateMatch = blockHtml.match(dateRegex);
    const link = dateMatch ? dateMatch[1] : `https://t.me/${channel}`;
    const pubDate = dateMatch ? dateMatch[2] : new Date().toISOString();

    const title = text.split('\n')[0].substring(0, 100);

    items.push({ title, description: text, link, pubDate, source: `t.me/${channel}` });
  }
  return items;
}

function parseRSSItems(xml: string, sourceName: string): LiveArticle[] {
  const items: LiveArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return (m?.[1] || m?.[2] || '').trim();
    };

    const title = getTag('title').replace(/<[^>]+>/g, '');
    const desc = getTag('description').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');

    items.push({
      title: title.length > 100 ? title.substring(0, 100) + '...' : title,
      description: desc,
      link: getTag('link'),
      pubDate: getTag('pubDate') || new Date().toISOString(),
      source: sourceName
    });
  }
  return items;
}

async function loadLiveNews(): Promise<NewsResponse> {
  const feedPromises = TELEGRAM_CHANNELS.map(async (channel) => {
    try {
      const res = await fetch(`https://t.me/s/${channel}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      if (!res.ok) return [];
      const html = await res.text();
      return parseTelegramHTML(html, channel).slice(-8);
    } catch { return []; }
  });

  const feedResults = await Promise.allSettled(feedPromises);
  const allArticles: LiveArticle[] = [];

  for (const result of feedResults) {
    if (result.status === 'fulfilled') allArticles.push(...result.value);
  }

  // FAILSAFE: If Telegram completely blocks the IP, fall back to traditional RSS
  if (allArticles.length === 0) {
    const fallbackPromises = Object.entries(FALLBACK_FEEDS).map(async ([source, url]) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSSItems(xml, source).slice(0, 5);
      } catch { return []; }
    });

    const fallbackResults = await Promise.allSettled(fallbackPromises);
    for (const result of fallbackResults) {
      if (result.status === 'fulfilled') allArticles.push(...result.value);
    }
  }

  const newsItems = allArticles.map(article => {
    const riskScore = scoreRisk(article.description || article.title);
    const coords = findCoords(article.description || article.title);

    return {
      id: crypto.createHash('md5').update((article.link || '') + (article.pubDate || '')).digest('hex'),
      title: article.title,
      description: article.description,
      link: article.link,
      published: article.pubDate,
      source: article.source,
      risk_score: riskScore,
      coords: coords ? [coords[0], coords[1]] as [number, number] : null,
      coords_default: !coords,
      machine_assessment: riskScore >= 8 ? "AI Analysis indicates elevated tactical priority based on OSINT stream patterns." : null,
    };
  });

  newsItems.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

  return {
    news: newsItems,
    total: newsItems.length,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const snapshot = await loadPersistedSnapshot(loadPersistedRuntimeConfig('NEWS', process.env, 86_400_000), {
      label: 'news',
      getDatabaseResult: (windowMs) => loadNewsDatabaseResult(windowMs),
      buildDatabaseResponse: buildNewsResponse,
      loadLive: loadLiveNews,
      warn: (message) => console.warn(message),
    });
    return NextResponse.json(snapshot.response, {
      headers: persistedResponseHeaders('News', snapshot, SUCCESS_CACHE_CONTROL),
    });
  } catch (error) {
    if (error instanceof PersistedDatabaseUnavailableError) {
      console.error('[news] Database mode unavailable:', error.message);
      return NextResponse.json(
        { news: [], error: 'News database unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('News fetch error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ news: [], error: 'Failed to fetch intel' }, { status: 500 });
  }
}
