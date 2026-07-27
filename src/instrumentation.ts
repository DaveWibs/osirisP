// Next.js runs register() once at server startup. We use it to apply the same
// network fix the World-State collector needs: on hosts without a working IPv6
// route, undici's Happy Eyeballs abandons a slow-but-working IPv4 connect after
// 250ms and falls through to an unreachable AAAA address, so server-side fetches
// to dual-stack feeds (adsb.lol, NASA EONET/FIRMS, SatNOGS, …) intermittently
// fail with ETIMEDOUT. Because the API routes fan out with Promise.allSettled,
// those failures are silently swallowed and the app serves degraded data.
export async function register(): Promise<void> {
  // node:dns / node:net are unavailable on the edge runtime, so the actual fix
  // lives in a Node-only module imported dynamically behind this guard — that
  // keeps Next's edge bundler from pulling node built-ins into the edge chunk.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}
