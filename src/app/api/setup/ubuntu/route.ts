import { NextRequest, NextResponse } from 'next/server';
import {
  UbuntuSetupError,
  applyUbuntuSetup,
  generateSetupPassword,
  isSetupAuthorized,
  loadSetupStatus,
  readSetupAccess,
  type UbuntuSetupInput,
} from '@/lib/setup/ubuntu-wizard';

export const runtime = 'nodejs';

type SetupAction = 'apply' | 'generate-password';

interface SetupRequestBody extends Partial<UbuntuSetupInput> {
  action?: SetupAction;
  token?: string;
}

export async function GET() {
  const status = await loadSetupStatus();
  return NextResponse.json(status, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  let body: SetupRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const action = body.action ?? 'apply';
  if (action === 'generate-password') {
    return NextResponse.json({ password: generateSetupPassword() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const access = readSetupAccess();
  if (!access.enabled) {
    return NextResponse.json({
      error: 'GUI setup mutations are disabled. Set OSIRIS_SETUP_ENABLED=1 before starting the setup server.',
    }, { status: 403 });
  }
  if (!isSetupAuthorized(body.token)) {
    return NextResponse.json({
      error: access.token
        ? 'Invalid setup token.'
        : 'Set OSIRIS_SETUP_TOKEN, or explicitly set OSIRIS_SETUP_ALLOW_UNAUTHENTICATED=1 for local setup only.',
    }, { status: 403 });
  }

  try {
    const result = await applyUbuntuSetup({
      mode: requiredString(body.mode, 'mode') as UbuntuSetupInput['mode'],
      dataRoot: requiredString(body.dataRoot, 'dataRoot'),
      device: optionalString(body.device),
      persistFstab: Boolean(body.persistFstab),
      allowNonMountRoot: Boolean(body.allowNonMountRoot),
      osirisPort: requiredString(body.osirisPort, 'osirisPort'),
      dbName: requiredString(body.dbName, 'dbName'),
      dbUser: requiredString(body.dbUser, 'dbUser'),
      dbPassword: requiredString(body.dbPassword, 'dbPassword'),
      archiveContainerPath: optionalString(body.archiveContainerPath),
      validateCompose: Boolean(body.validateCompose),
    });
    return NextResponse.json({ ok: true, result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof UbuntuSetupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Setup failed',
    }, { status: 500 });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UbuntuSetupError(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
