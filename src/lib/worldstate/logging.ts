import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

const SENSITIVE_KEY_PATTERN = /key|token|secret|password|passwd|credential|signature|authorization|auth|cookie/i;
const MAX_LOG_STRING_LENGTH = 500;
const MAX_LOG_DEPTH = 6;

export interface WorldStateErrorLogInput {
  route: string;
  operation: string;
  request?: NextRequest;
  requestId?: string | null;
  context?: Record<string, unknown>;
}

export interface WorldStateErrorLogRecord {
  event: 'worldstate.error';
  service: 'osiris-worldstate-api';
  route: string;
  operation: string;
  requestId: string;
  method: string | null;
  path: string | null;
  context: Record<string, unknown>;
  error: Record<string, unknown>;
}

export function logWorldStateError(error: unknown, input: WorldStateErrorLogInput): WorldStateErrorLogRecord {
  const record = buildWorldStateErrorLogRecord(error, input);
  console.error('[worldstate:error]', record);
  return record;
}

export function buildWorldStateErrorLogRecord(
  error: unknown,
  input: WorldStateErrorLogInput,
): WorldStateErrorLogRecord {
  return {
    event: 'worldstate.error',
    service: 'osiris-worldstate-api',
    route: input.route,
    operation: input.operation,
    requestId: readWorldStateRequestId(input.request, input.requestId),
    method: input.request?.method ?? null,
    path: input.request?.nextUrl?.pathname ?? null,
    context: sanitiseWorldStateLogObject(input.context ?? {}),
    error: sanitiseWorldStateError(error),
  };
}

export function readWorldStateRequestId(request?: NextRequest, explicit?: string | null): string {
  const candidate = explicit?.trim()
    || request?.headers?.get('x-request-id')?.trim()
    || request?.headers?.get('x-correlation-id')?.trim();
  if (candidate && /^[A-Za-z0-9_.:-]{1,160}$/.test(candidate)) return candidate;
  return randomUUID();
}

export function sanitiseWorldStateError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const payload: Record<string, unknown> = {
      name: error.name,
      message: sanitiseWorldStateLogValue(error.message, 0),
    };
    if (error.stack) {
      payload.stack = sanitiseWorldStateLogValue(error.stack, 0);
    }
    if ('cause' in error && error.cause !== undefined) {
      payload.cause = sanitiseWorldStateLogValue(error.cause, 0);
    }
    return payload;
  }
  return {
    name: typeof error,
    message: 'Non-Error value thrown',
    value: sanitiseWorldStateLogValue(error, 0),
  };
}

export function sanitiseWorldStateLogObject(value: Record<string, unknown>): Record<string, unknown> {
  return sanitiseObject(value, 0);
}

function sanitiseObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitiseWorldStateLogValue(entry, depth + 1);
  }
  return result;
}

function sanitiseWorldStateLogValue(value: unknown, depth: number): unknown {
  if (depth > MAX_LOG_DEPTH) return '[truncated]';
  if (typeof value === 'string') return sanitiseString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitiseWorldStateLogValue(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitiseObject(value as Record<string, unknown>, depth);
  }
  return value;
}

function sanitiseString(value: string): string {
  const redacted = value.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi, sanitiseUrl).replace(
    /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    '$1[redacted]',
  );
  return redacted.length > MAX_LOG_STRING_LENGTH
    ? `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}...`
    : redacted;
}

function sanitiseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  parsed.username = '';
  parsed.password = '';
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_KEY_PATTERN.test(name)) {
      parsed.searchParams.set(name, 'redacted');
    }
  }
  return parsed.toString();
}
