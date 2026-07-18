import { NextRequest, NextResponse } from 'next/server';
import { getWorldStateDatabase } from '@/lib/worldstate/database';
import { logWorldStateError } from '@/lib/worldstate/logging';
import { WorldStateService, type WorldStateEvidenceQuery } from '@/lib/worldstate/service';
import type { WorldStateEvidenceClassification, WorldStateEvidenceRelationType } from '@/lib/worldstate/contract';

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

    const payload = await new WorldStateService(database).listEvidenceEdges(readEvidenceQuery(request.nextUrl.searchParams));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logWorldStateError(error, { route: '/api/v1/evidence', operation: 'get_evidence_graph', request });
    return NextResponse.json(emptyResponse('Failed to load World-State evidence graph'), {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function readEvidenceQuery(searchParams: URLSearchParams): WorldStateEvidenceQuery {
  return {
    nodeKey: searchParams.get('node_key') ?? undefined,
    fromNodeKey: searchParams.get('from_node_key') ?? undefined,
    toNodeKey: searchParams.get('to_node_key') ?? undefined,
    relationTypes: readCsv(searchParams, 'relation_type') as WorldStateEvidenceRelationType[],
    sourceIds: readCsv(searchParams, 'source_id'),
    evidenceClassifications: readCsv(searchParams, 'classification') as WorldStateEvidenceClassification[],
    limit: readInteger(searchParams.get('limit')),
    cursor: searchParams.get('cursor') ?? undefined,
  };
}

function emptyResponse(error: string) {
  return {
    edges: [],
    page: { limit: 0, returned: 0, nextCursor: null },
    generatedAt: new Date().toISOString(),
    filters: {
      nodeKey: null,
      fromNodeKey: null,
      toNodeKey: null,
      relationTypes: [],
      sourceIds: [],
      evidenceClassifications: [],
    },
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
