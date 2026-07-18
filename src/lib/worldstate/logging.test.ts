import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWorldStateErrorLogRecord,
  logWorldStateError,
  sanitiseWorldStateError,
  sanitiseWorldStateLogObject,
} from './logging';

describe('World-State logging', () => {
  it('builds structured error records with request context', () => {
    const request = requestFor('/api/v1/runs/550e8400-e29b-41d4-a716-446655440002', {
      'x-request-id': 'req-123',
    });

    const record = buildWorldStateErrorLogRecord(new Error('database unavailable'), {
      route: '/api/v1/runs/[id]',
      operation: 'get_collection_run',
      request,
      context: { collectionRunId: '550e8400-e29b-41d4-a716-446655440002' },
    });

    expect(record).toMatchObject({
      event: 'worldstate.error',
      service: 'osiris-worldstate-api',
      route: '/api/v1/runs/[id]',
      operation: 'get_collection_run',
      requestId: 'req-123',
      method: 'GET',
      path: '/api/v1/runs/550e8400-e29b-41d4-a716-446655440002',
      context: { collectionRunId: '550e8400-e29b-41d4-a716-446655440002' },
      error: { name: 'Error', message: 'database unavailable' },
    });
  });

  it('redacts sensitive object keys and secret-bearing URLs', () => {
    const error = sanitiseWorldStateError(new Error(
      'failed for https://user:pass@example.test/feed?api_key=secret&symbol=BTC with Authorization: Bearer token-123',
    ));
    const context = sanitiseWorldStateLogObject({
      endpoint: 'https://user:pass@example.test/feed?token=abc&symbol=BTC',
      authorization: 'Bearer token-123',
      nested: { dbPassword: 'secret' },
    });

    expect(String(error.message)).not.toContain('user:pass');
    expect(String(error.message)).not.toContain('secret');
    expect(String(error.message)).not.toContain('token-123');
    expect(String(error.message)).toContain('api_key=redacted');
    expect(context.endpoint).toBe('https://example.test/feed?token=redacted&symbol=BTC');
    expect(context.authorization).toBe('[redacted]');
    expect(context.nested).toEqual({ dbPassword: '[redacted]' });
  });

  it('redacts PostgreSQL connection string credentials', () => {
    const error = sanitiseWorldStateError(new Error('failed to connect to postgresql://user:secret@example.test/osiris'));

    expect(String(error.message)).toBe('failed to connect to postgresql://example.test/osiris');
    expect(String(error.stack)).not.toContain('secret');
  });

  it('logs a single structured object', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const record = logWorldStateError(new Error('boom'), {
      route: '/api/v1/readiness',
      operation: 'get_readiness',
      requestId: 'req-456',
    });

    expect(spy).toHaveBeenCalledWith('[worldstate:error]', record);
    expect(record.requestId).toBe('req-456');
    spy.mockRestore();
  });
});

function requestFor(path: string, headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    method: 'GET',
    nextUrl: new URL(path, 'http://localhost:3000'),
  } as NextRequest;
}
