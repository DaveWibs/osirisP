import { describe, expect, it, vi } from 'vitest';
import type {
  WorldStateClaimNotificationDispatchResponse,
  WorldStateNotificationDispatchItem,
  WorldStateRecordNotificationDeliveryInput,
} from './service';
import {
  formatTelegramNotification,
  loadTelegramNotifierConfig,
  runTelegramNotificationDelivery,
  type TelegramDeliveryService,
} from './telegram-notifier';

class FakeDeliveryService implements TelegramDeliveryService {
  readonly recorded: WorldStateRecordNotificationDeliveryInput[] = [];

  constructor(private readonly claim: WorldStateClaimNotificationDispatchResponse) {}

  async claimNotificationDeliveriesForDispatch() {
    return this.claim;
  }

  async recordNotificationDelivery(input: WorldStateRecordNotificationDeliveryInput) {
    this.recorded.push(input);
    return {};
  }
}

describe('Telegram notification delivery', () => {
  it('stays disabled by default and does not claim notifications', async () => {
    const service = new FakeDeliveryService(claimResponse([telegramNotification()]));

    const response = await runTelegramNotificationDelivery({
      environment: {},
      service,
      fetcher: vi.fn(),
      now: new Date('2026-07-18T00:00:00Z'),
    });

    expect(response).toEqual({
      status: 'disabled',
      deliveryRunId: null,
      notificationsClaimed: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
      dryRun: false,
      generatedAt: '2026-07-18T00:00:00.000Z',
    });
    expect(service.recorded).toEqual([]);
  });

  it('requires a bot token when enabled outside dry-run mode', () => {
    expect(() => loadTelegramNotifierConfig({
      WORLDSTATE_TELEGRAM_NOTIFICATIONS_ENABLED: '1',
      WORLDSTATE_TELEGRAM_DRY_RUN: '0',
    })).toThrow('TELEGRAM_BOT_TOKEN is required');
  });

  it('sends claimed Telegram notifications and records delivery metadata', async () => {
    const service = new FakeDeliveryService(claimResponse([telegramNotification()]));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await runTelegramNotificationDelivery({
      environment: {
        WORLDSTATE_TELEGRAM_NOTIFICATIONS_ENABLED: '1',
        TELEGRAM_BOT_TOKEN: 'bot-token',
        WORLDSTATE_TELEGRAM_CLAIM_LIMIT: '2',
      },
      service,
      fetcher,
      now: new Date('2026-07-18T00:00:00Z'),
      deliveryRunIdFactory: () => 'telegram-delivery-run-1',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"chat_id":"telegram-chat-ref"'),
      }),
    );
    expect(response).toMatchObject({
      status: 'delivered',
      deliveryRunId: 'telegram-delivery-run-1',
      notificationsClaimed: 1,
      notificationsSent: 1,
      notificationsFailed: 0,
    });
    expect(service.recorded[0]).toMatchObject({
      notificationId: '550e8400-e29b-41d4-a716-446655441001',
      success: true,
      httpStatus: 200,
      responseHeaders: { 'content-type': 'application/json' },
      metadata: { adapter: 'telegram', dryRun: false, deliveryRunId: 'telegram-delivery-run-1' },
    });
    expect(service.recorded[0]?.responseBodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records non-success Telegram API responses as failed attempts', async () => {
    const service = new FakeDeliveryService(claimResponse([telegramNotification()]));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      description: 'chat not found',
    }), {
      status: 400,
      headers: { 'retry-after': '30' },
    }));

    await runTelegramNotificationDelivery({
      environment: {
        WORLDSTATE_TELEGRAM_NOTIFICATIONS_ENABLED: '1',
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      service,
      fetcher,
      now: new Date('2026-07-18T00:00:00Z'),
      deliveryRunIdFactory: () => 'telegram-delivery-run-2',
    });

    expect(service.recorded[0]).toMatchObject({
      success: false,
      httpStatus: 400,
      responseHeaders: { 'retry-after': '30' },
      error: {
        httpStatus: 400,
        message: 'chat not found',
      },
      metadata: {
        adapter: 'telegram',
        dryRun: false,
        deliveryRunId: 'telegram-delivery-run-2',
      },
    });
  });

  it('formats bounded plain-text alert messages', () => {
    const message = formatTelegramNotification(telegramNotification({
      alert: {
        ...telegramNotification().alert,
        detail: 'x'.repeat(5000),
      },
    }));

    expect(message).toContain('OSIRIS CRITICAL alert');
    expect(message.length).toBeLessThanOrEqual(4000);
  });
});

function claimResponse(notifications: WorldStateNotificationDispatchItem[]): WorldStateClaimNotificationDispatchResponse {
  return {
    notificationsClaimed: notifications.length,
    notifications,
    generatedAt: '2026-07-18T00:00:00.000Z',
    filters: { adapters: ['telegram'], limit: 10, leaseSeconds: 300 },
  };
}

function telegramNotification(
  overrides: Partial<WorldStateNotificationDispatchItem> = {},
): WorldStateNotificationDispatchItem {
  return {
    id: '550e8400-e29b-41d4-a716-446655441001',
    outboxKey: 'notification:telegram:ops:alert',
    dedupeKey: 'telegram:ops:alert',
    destinationRef: 'telegram-chat-ref',
    adapter: 'telegram',
    topic: 'market_price_movement',
    severity: 'critical',
    status: 'delivering',
    payload: {},
    availableAt: '2026-07-18T00:00:00.000Z',
    lockedAt: '2026-07-18T00:00:00.000Z',
    sentAt: null,
    failedAt: null,
    attemptCount: 1,
    maxAttempts: 5,
    lastError: null,
    metadata: {},
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    subscription: {
      id: '550e8400-e29b-41d4-a716-446655441101',
      subscriptionKey: 'telegram:ops',
      adapter: 'telegram',
      enabled: true,
      minSeverity: 'warning',
      topics: ['market_price_movement'],
      metadata: {},
    },
    alert: {
      id: '550e8400-e29b-41d4-a716-446655440101',
      alertKey: 'market_price_movement:coingecko-simple-price:crypto_asset:bitcoin',
      kind: 'market_price_movement',
      severity: 'critical',
      status: 'active',
      sourceId: 'coingecko-simple-price',
      sourceName: 'CoinGecko Simple Price BTC ETH SOL USD',
      provider: 'CoinGecko',
      entityType: 'crypto_asset',
      entityId: 'bitcoin',
      title: 'BTC price moved 30% above baseline',
      detail: 'BTC latest price 130 USD is 30% above the median.',
      detectedAt: '2026-07-18T00:00:00.000Z',
      windowStart: '2026-07-17T00:00:00.000Z',
      windowEnd: '2026-07-18T00:00:00.000Z',
      evidenceClassification: 'derived',
      method: 'median-baseline-percent-move-with-mad-context',
      calculationVersion: 'market-price-movement-v1',
      thresholds: { thresholdPercent: 5 },
      inputWindow: { samples: 12 },
      evidence: { latestRawObservationId: '550e8400-e29b-41d4-a716-446655440201' },
      explanation: 'Derived from observed price history using a median baseline.',
      explanationStatus: 'unexplained',
      metadata: {},
      raw: null,
    },
    ...overrides,
  };
}
