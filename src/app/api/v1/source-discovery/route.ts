import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import {
  WorldStateService,
  type WorldStateCreateSourceDiscoveryCandidateInput,
  type WorldStateSourceDiscoveryQuery,
} from '@/lib/worldstate/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json(emptyResponse('World-State database is not configured'), {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = await new WorldStateService(database)
      .listSourceDiscoveryCandidates(readSourceDiscoveryQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logWorldStateError(error, { route: '/api/v1/source-discovery', operation: 'get_source_discovery_candidates', request });
    return NextResponse.json(emptyResponse('Failed to load World-State source discovery candidates'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const writeToken = process.env.WORLDSTATE_SOURCE_DISCOVERY_TOKEN?.trim();
    if (!writeToken) {
      return NextResponse.json({ error: 'World-State source discovery writes are not configured' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (readBearerToken(request) !== writeToken) {
      return NextResponse.json({ error: 'Unauthorized' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const database = getWorldStateDatabase();
    if (database === null) {
      return NextResponse.json({ error: 'World-State database is not configured' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const input = readCandidateInput(await request.json());
    const candidate = await new WorldStateService(database).createSourceDiscoveryCandidate(input);
    return NextResponse.json({ candidate, generatedAt: new Date().toISOString() }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SourceDiscoveryValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    logWorldStateError(error, { route: '/api/v1/source-discovery', operation: 'create_source_discovery_candidate', request });
    return NextResponse.json({ error: 'Failed to create World-State source discovery candidate' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readSourceDiscoveryQuery(searchParams: URLSearchParams): WorldStateSourceDiscoveryQuery {
  return {
    statuses: readCsv(searchParams, 'status'),
    providers: readCsv(searchParams, 'provider'),
    costClasses: readCsv(searchParams, 'cost_class'),
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function readCandidateInput(value: unknown): WorldStateCreateSourceDiscoveryCandidateInput {
  const record = objectBody(value);
  return {
    title: requiredString(record, 'title'),
    provider: requiredString(record, 'provider'),
    endpointUrl: requiredHttpUrl(record, 'endpointUrl'),
    documentationUrl: optionalHttpUrl(record, 'documentationUrl'),
    termsUrl: optionalHttpUrl(record, 'termsUrl'),
    licence: optionalString(record, 'licence'),
    costClass: optionalEnum(record, 'costClass', ['free', 'free_tier', 'paid', 'unknown']),
    accessMethod: requiredString(record, 'accessMethod'),
    status: optionalEnum(record, 'status', ['candidate', 'needs_review', 'approved', 'rejected']),
    evidenceClassification: optionalEnum(record, 'evidenceClassification', [
      'observed',
      'reported',
      'derived',
      'inferred',
      'hypothesis',
    ]),
    rationale: requiredString(record, 'rationale'),
    metadata: optionalObject(record, 'metadata'),
  };
}

function emptyResponse(error: string) {
  return {
    candidates: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: { statuses: [], providers: [], costClasses: [] },
    error,
  };
}

function readCsv(searchParams: URLSearchParams, name: string): string[] {
  return searchParams.getAll(name).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function readInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization === null) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceDiscoveryValidationError('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SourceDiscoveryValidationError(`${field} is required`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new SourceDiscoveryValidationError(`${field} must be a string`);
  }
  return value;
}

function optionalEnum(record: Record<string, unknown>, field: string, allowed: string[]): string | undefined {
  const value = optionalString(record, field);
  if (value === null) return undefined;
  if (!allowed.includes(value.trim())) {
    throw new SourceDiscoveryValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function requiredHttpUrl(record: Record<string, unknown>, field: string): string {
  return validateHttpUrl(requiredString(record, field), field);
}

function optionalHttpUrl(record: Record<string, unknown>, field: string): string | null {
  const value = optionalString(record, field);
  return value === null || value.trim() === '' ? null : validateHttpUrl(value, field);
}

function validateHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SourceDiscoveryValidationError(`${field} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SourceDiscoveryValidationError(`${field} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new SourceDiscoveryValidationError(`${field} must not include credentials`);
  }
  return value;
}

function optionalObject(record: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceDiscoveryValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

class SourceDiscoveryValidationError extends Error {}
