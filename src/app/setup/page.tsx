'use client';

import { useEffect, useMemo, useState } from 'react';

type StorageSetupMode = 'mounted_path' | 'mount_existing_filesystem' | 'local_default';

interface BlockDevice {
  name: string;
  path: string;
  size: string;
  type: string;
  fstype: string;
  label: string;
  uuid: string;
  mountpoints: string[];
  model: string;
}

interface SetupStatus {
  enabled: boolean;
  tokenConfigured: boolean;
  unauthenticatedMutationsAllowed: boolean;
  platform: string;
  isUbuntu: boolean;
  isRoot: boolean;
  commands: Record<'lsblk' | 'findmnt' | 'docker' | 'mount' | 'sudo', boolean>;
  defaultDataRoot: string;
  envExists: boolean;
  devices: BlockDevice[];
  readiness: SetupReadinessItem[];
  warnings: string[];
}

interface SetupReadinessItem {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

interface SetupForm {
  token: string;
  mode: StorageSetupMode;
  dataRoot: string;
  device: string;
  persistFstab: boolean;
  allowNonMountRoot: boolean;
  osirisPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  validateCompose: boolean;
}

interface SetupResult {
  dataRoot: string;
  dbHostPath: string;
  archiveHostPath: string;
  archiveContainerPath: string;
  envPath: string;
  envBackupPath?: string;
  mounted?: {
    device: string;
    mountPoint: string;
    fstabUpdated: boolean;
  };
  composeValidated: boolean;
  environment: {
    osirisPort: string;
    dbName: string;
    dbUser: string;
    dbPasswordSet: boolean;
    collectorSources: string;
    databaseModes: {
      earthquakes: string;
      flights: string;
      markets: string;
    news: string;
    fires: string;
    weather: string;
    spaceWeather: string;
    radar: string;
    airQuality: string;
    crypto: string;
    };
  };
  nextCommands: string[];
  warnings: string[];
}

const inputStyle = {
  width: '100%',
  border: '1px solid rgba(212, 175, 55, 0.25)',
  borderRadius: 10,
  background: 'rgba(4, 4, 10, 0.78)',
  color: '#E8E6E0',
  padding: '10px 12px',
  fontFamily: 'var(--font-hud)',
  fontSize: 12,
} as const;

const labelStyle = {
  display: 'grid',
  gap: 8,
  color: '#9B978E',
  fontSize: 12,
  letterSpacing: '0.04em',
} as const;

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [form, setForm] = useState<SetupForm>({
    token: '',
    mode: 'mounted_path',
    dataRoot: '/mnt/osiris-worldstate',
    device: '',
    persistFstab: true,
    allowNonMountRoot: false,
    osirisPort: '3000',
    dbName: 'osiris_worldstate',
    dbUser: 'osiris',
    dbPassword: '',
    validateCompose: true,
  });

  useEffect(() => {
    void refreshStatus();
  }, []);

  const usableDevices = useMemo(
    () => status?.devices.filter((device) => device.path && device.fstype) ?? [],
    [status],
  );
  const selectedDevice = useMemo(
    () => usableDevices.find((device) => device.path === form.device) ?? null,
    [form.device, usableDevices],
  );
  const plannedPaths = useMemo(() => {
    const dataRoot = normaliseDataRootForDisplay(form.dataRoot);
    return {
      dataRoot,
      dbHostPath: `${dataRoot}/postgres`,
      archiveHostPath: `${dataRoot}/archive`,
      archiveContainerPath: '/archive',
    };
  }, [form.dataRoot]);

  async function refreshStatus() {
    setLoadingStatus(true);
    setError('');
    try {
      const response = await fetch('/api/setup/ubuntu', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load setup status');
      }
      setStatus(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load setup status');
    } finally {
      setLoadingStatus(false);
    }
  }

  async function generatePassword() {
    setError('');
    try {
      const response = await fetch('/api/setup/ubuntu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-password' }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to generate password');
      }
      setForm((current) => ({ ...current, dbPassword: payload.password }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to generate password');
    }
  }

  async function applySetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/setup/ubuntu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          ...form,
          device: form.mode === 'mount_existing_filesystem' ? form.device : undefined,
          allowNonMountRoot: form.mode === 'local_default' ? true : form.allowNonMountRoot,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Setup failed');
      }
      setResult(payload.result as SetupResult);
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  const update = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <main style={{
      minHeight: '100vh',
      overflow: 'auto',
      background: 'radial-gradient(circle at top left, rgba(212,175,55,0.16), transparent 34%), var(--bg-void)',
      color: 'var(--text-primary)',
      padding: '32px',
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 18 }}>
        <section className="glass-panel osiris-glow" style={{ padding: 24 }}>
          <p className="hud-label">OSIRIS self-hosted setup</p>
          <h1 style={{ margin: '8px 0 10px', fontSize: 34, letterSpacing: '-0.04em' }}>
            Ubuntu world-state install wizard
          </h1>
          <p style={{ maxWidth: 820, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Prepare PostgreSQL storage and raw archives for the OSIRIS world-state database.
            This wizard can use an already mounted path, mount an existing formatted filesystem,
            or fall back to local storage for testing. It never formats or partitions disks.
          </p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.8fr)', gap: 18 }}>
          <form className="glass-panel" onSubmit={applySetup} style={{ padding: 22, display: 'grid', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <p className="hud-label">Configuration</p>
                <h2 style={{ margin: '6px 0 0', fontSize: 22 }}>Storage and database</h2>
              </div>
              <button type="button" onClick={refreshStatus} disabled={loadingStatus} style={buttonStyle('secondary')}>
                Refresh devices
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <ModeCard
                active={form.mode === 'mounted_path'}
                title="Already mounted"
                text="Use a disk mounted by Disks, Cockpit, fstab, cloud-init, or your own server workflow."
                onClick={() => update('mode', 'mounted_path')}
              />
              <ModeCard
                active={form.mode === 'mount_existing_filesystem'}
                title="Mount filesystem"
                text="Mount an existing formatted partition now. Requires root or passwordless sudo."
                onClick={() => update('mode', 'mount_existing_filesystem')}
              />
              <ModeCard
                active={form.mode === 'local_default'}
                title="Local default"
                text="Use /srv/osiris-worldstate on the current OS disk for test or single-disk installs."
                onClick={() => setForm((current) => ({
                  ...current,
                  mode: 'local_default',
                  dataRoot: status?.defaultDataRoot ?? '/srv/osiris-worldstate',
                }))}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              <label style={labelStyle}>
                Setup token
                <input
                  style={inputStyle}
                  type="password"
                  value={form.token}
                  onChange={(event) => update('token', event.target.value)}
                  placeholder={status?.tokenConfigured ? 'Required' : 'Optional only when explicitly allowed'}
                />
              </label>
              <label style={labelStyle}>
                Data root
                <input
                  style={inputStyle}
                  value={form.dataRoot}
                  onChange={(event) => update('dataRoot', event.target.value)}
                  placeholder="/mnt/osiris-worldstate"
                />
              </label>
            </div>

            {form.mode === 'mount_existing_filesystem' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 14 }}>
                <label style={labelStyle}>
                  Existing filesystem device
                  <select
                    style={inputStyle}
                    value={form.device}
                    onChange={(event) => update('device', event.target.value)}
                  >
                    <option value="">Select a formatted device</option>
                    {usableDevices.map((device) => (
                      <option key={device.path} value={device.path}>
                        {device.path} · {device.size} · {device.fstype || 'no fs'} · {device.mountpoints.join(', ') || 'unmounted'}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...labelStyle, alignContent: 'end' }}>
                  <span>
                    <input
                      type="checkbox"
                      checked={form.persistFstab}
                      onChange={(event) => update('persistFstab', event.target.checked)}
                    />{' '}
                    Add UUID fstab entry
                  </span>
                </label>
              </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
              <label style={labelStyle}>
                Web UI port
                <input style={inputStyle} value={form.osirisPort} onChange={(event) => update('osirisPort', event.target.value)} />
              </label>
              <label style={labelStyle}>
                Database name
                <input style={inputStyle} value={form.dbName} onChange={(event) => update('dbName', event.target.value)} />
              </label>
              <label style={labelStyle}>
                Database user
                <input style={inputStyle} value={form.dbUser} onChange={(event) => update('dbUser', event.target.value)} />
              </label>
              <label style={labelStyle}>
                Database password
                <span style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={inputStyle}
                    type="password"
                    value={form.dbPassword}
                    onChange={(event) => update('dbPassword', event.target.value)}
                  />
                  <button type="button" onClick={generatePassword} style={buttonStyle('secondary')}>
                    Generate
                  </button>
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 13 }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.allowNonMountRoot}
                  onChange={(event) => update('allowNonMountRoot', event.target.checked)}
                  disabled={form.mode === 'local_default'}
                />{' '}
                Allow path that is not a mount root
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.validateCompose}
                  onChange={(event) => update('validateCompose', event.target.checked)}
                />{' '}
                Validate Docker Compose after writing .env
              </label>
            </div>

            {error ? <Message tone="error" text={error} /> : null}
            {result ? <SetupResultPanel result={result} /> : null}

            <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
              {submitting ? 'Applying setup…' : 'Apply setup'}
            </button>
          </form>

          <aside className="glass-panel" style={{ padding: 22, display: 'grid', gap: 16, alignContent: 'start' }}>
            <div>
              <p className="hud-label">Host status</p>
              <h2 style={{ margin: '6px 0 0', fontSize: 22 }}>Readiness</h2>
            </div>

            {!status ? (
              <p style={{ color: 'var(--text-secondary)' }}>{loadingStatus ? 'Loading host status…' : 'No status loaded.'}</p>
            ) : (
              <>
                <StatusRow label="Setup mutations" value={status.enabled ? 'enabled' : 'disabled'} ok={status.enabled} />
                <StatusRow label="Token configured" value={status.tokenConfigured ? 'yes' : status.unauthenticatedMutationsAllowed ? 'not required' : 'no'} ok={status.tokenConfigured || status.unauthenticatedMutationsAllowed} />
                <StatusRow label="Ubuntu host" value={status.isUbuntu ? 'yes' : status.platform} ok={status.isUbuntu} />
                <StatusRow label="Root process" value={status.isRoot ? 'yes' : 'no'} ok={status.isRoot} />
                <StatusRow label="Docker" value={status.commands.docker ? 'available' : 'missing'} ok={status.commands.docker} />
                <StatusRow label="lsblk/findmnt" value={status.commands.lsblk && status.commands.findmnt ? 'available' : 'missing'} ok={status.commands.lsblk && status.commands.findmnt} />
                <StatusRow label=".env" value={status.envExists ? 'will be backed up' : 'not present'} ok />

                <div>
                  <p className="hud-label">Setup readiness</p>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {status.readiness.map((item) => (
                      <ReadinessCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>

                <div style={{ border: '1px solid rgba(0,229,255,0.14)', borderRadius: 12, padding: 12, background: 'rgba(0,229,255,0.05)', display: 'grid', gap: 8 }}>
                  <p className="hud-label">Planned storage</p>
                  <KeyValueRows entries={[
                    ['data root', plannedPaths.dataRoot],
                    ['postgres', plannedPaths.dbHostPath],
                    ['archive host', plannedPaths.archiveHostPath],
                    ['archive container', plannedPaths.archiveContainerPath],
                    ['selected disk', selectedDevice ? `${selectedDevice.path} · ${selectedDevice.size} · ${selectedDevice.fstype}` : 'not selected'],
                  ]} />
                </div>

                {!status.enabled ? (
                  <Message
                    tone="warn"
                    text="Start OSIRIS setup with OSIRIS_SETUP_ENABLED=1 and OSIRIS_SETUP_TOKEN set before using Apply setup."
                  />
                ) : null}

                {status.warnings.map((warning) => (
                  <Message key={warning} tone="warn" text={warning} />
                ))}

                <div>
                  <p className="hud-label">Detected filesystems</p>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {usableDevices.length ? usableDevices.map((device) => (
                      <div key={device.path} style={{ border: '1px solid rgba(212,175,55,0.12)', borderRadius: 10, padding: 10 }}>
                        <div style={{ color: 'var(--text-heading)', fontFamily: 'var(--font-hud)', fontSize: 12 }}>{device.path}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          {device.size} · {device.fstype} · {device.mountpoints.join(', ') || 'unmounted'}
                        </div>
                      </div>
                    )) : (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No formatted block devices detected.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

function ModeCard({ active, title, text, onClick }: {
  active: boolean;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      textAlign: 'left',
      border: `1px solid ${active ? 'rgba(212,175,55,0.6)' : 'rgba(212,175,55,0.15)'}`,
      borderRadius: 14,
      background: active ? 'rgba(212,175,55,0.12)' : 'rgba(4,4,10,0.45)',
      color: 'var(--text-primary)',
      padding: 14,
      cursor: 'pointer',
    }}>
      <div style={{ fontFamily: 'var(--font-hud)', color: active ? 'var(--text-gold)' : 'var(--text-heading)', fontSize: 12 }}>
        {title}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.45, margin: '8px 0 0' }}>{text}</p>
    </button>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(212,175,55,0.08)', paddingBottom: 8 }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <span style={{ color: ok ? 'var(--alert-green)' : 'var(--alert-orange)', fontFamily: 'var(--font-hud)', fontSize: 12 }}>{value}</span>
    </div>
  );
}

function ReadinessCard({ item }: { item: SetupReadinessItem }) {
  const color = item.status === 'pass' ? 'var(--alert-green)' : item.status === 'warn' ? 'var(--alert-orange)' : 'var(--alert-red)';
  return (
    <div style={{
      border: `1px solid ${item.status === 'pass' ? 'rgba(0,230,118,0.2)' : item.status === 'warn' ? 'rgba(255,149,0,0.28)' : 'rgba(255,61,61,0.32)'}`,
      borderRadius: 10,
      padding: 10,
      background: 'rgba(4,4,10,0.38)',
      display: 'grid',
      gap: 5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: 'var(--text-heading)', fontSize: 12 }}>{item.label}</span>
        <span style={{ color, fontFamily: 'var(--font-hud)', fontSize: 10 }}>{item.status}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.45 }}>{item.detail}</div>
    </div>
  );
}

function SetupResultPanel({ result }: { result: SetupResult }) {
  return (
    <div style={{
      border: '1px solid rgba(0,230,118,0.24)',
      borderRadius: 14,
      background: 'rgba(0,230,118,0.06)',
      padding: 14,
      display: 'grid',
      gap: 12,
    }}>
      <div>
        <p className="hud-label">Setup applied</p>
        <h3 style={{ margin: '5px 0 0', color: 'var(--text-heading)', fontSize: 17 }}>World-State storage is configured</h3>
      </div>
      <KeyValueRows entries={[
        ['data root', result.dataRoot],
        ['postgres', result.dbHostPath],
        ['archive host', result.archiveHostPath],
        ['env file', result.envPath],
        ['env backup', result.envBackupPath ?? 'not needed'],
        ['compose', result.composeValidated ? 'validated' : 'not validated'],
        ['collector set', result.environment.collectorSources],
      ]} />
      {result.mounted ? (
        <Message
          tone="warn"
          text={`${result.mounted.device} mounted at ${result.mounted.mountPoint}${result.mounted.fstabUpdated ? ' and added to /etc/fstab.' : '.'}`}
        />
      ) : null}
      {result.warnings.map((warning) => (
        <Message key={warning} tone="warn" text={warning} />
      ))}
      <div>
        <p className="hud-label">Next commands</p>
        <pre style={preStyle}>{result.nextCommands.join('\n')}</pre>
      </div>
    </div>
  );
}

function KeyValueRows({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {entries.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Message({ tone, text }: { tone: 'error' | 'warn'; text: string }) {
  return (
    <div style={{
      border: `1px solid ${tone === 'error' ? 'rgba(255,61,61,0.4)' : 'rgba(255,149,0,0.4)'}`,
      background: tone === 'error' ? 'rgba(255,61,61,0.08)' : 'rgba(255,149,0,0.08)',
      color: tone === 'error' ? '#ffb8b8' : '#ffd29a',
      borderRadius: 12,
      padding: 12,
      fontSize: 13,
      lineHeight: 1.45,
    }}>
      {text}
    </div>
  );
}

function buttonStyle(kind: 'primary' | 'secondary') {
  return {
    border: '1px solid rgba(212,175,55,0.36)',
    borderRadius: 10,
    background: kind === 'primary' ? 'rgba(212,175,55,0.18)' : 'rgba(4,4,10,0.62)',
    color: kind === 'primary' ? 'var(--text-heading)' : 'var(--text-gold)',
    padding: kind === 'primary' ? '12px 16px' : '9px 11px',
    fontFamily: 'var(--font-hud)',
    fontSize: 12,
    letterSpacing: '0.06em',
    cursor: 'pointer',
  } as const;
}

const preStyle = {
  overflow: 'auto',
  maxHeight: 280,
  border: '1px solid rgba(0,229,255,0.2)',
  borderRadius: 12,
  background: 'rgba(0,229,255,0.06)',
  color: 'var(--text-cyan)',
  padding: 12,
  fontSize: 12,
  lineHeight: 1.5,
} as const;

function normaliseDataRootForDisplay(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || '/mnt/osiris-worldstate';
}
