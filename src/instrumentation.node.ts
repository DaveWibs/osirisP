// Node.js-runtime-only network hardening, applied at server startup via the
// instrumentation register() hook. See instrumentation.ts for why.
//
// Prefer IPv4 results and disable undici's Happy Eyeballs family race so every
// server-side fetch connects to IPv4 first with the full connect-timeout budget,
// instead of dropping a slow-but-working IPv4 address for an unreachable IPv6 one
// on hosts without a working IPv6 route.
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';

setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
