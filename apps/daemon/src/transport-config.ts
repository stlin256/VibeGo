import type { TransportMode } from '@ready4vibe/auth';
import { resolveTlsCertificatePaths, type TlsCertificatePaths } from '@ready4vibe/certificates';
import { isLanHost, isLoopbackHost, type DaemonHost } from './server.js';

export interface DaemonTransportConfig {
  host: DaemonHost;
  transportMode: TransportMode;
  tlsRequired: boolean;
  tlsEnabled: boolean;
  certificatePaths?: TlsCertificatePaths;
}

export function resolveDaemonTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DaemonTransportConfig {
  const hostValue = env.READY4VIBE_HOST ?? '127.0.0.1';
  if (!isLoopbackHost(hostValue) && !isLanHost(hostValue)) {
    throw new Error('READY4VIBE_HOST must be 127.0.0.1, ::1, 0.0.0.0 or ::');
  }
  const host: DaemonHost = hostValue;
  const transportMode: TransportMode = isLoopbackHost(host) ? 'loopback' : 'lan';
  if (transportMode === 'lan' && env.READY4VIBE_ALLOW_LAN !== '1') {
    throw new Error('LAN binding is disabled by default; set READY4VIBE_ALLOW_LAN=1 explicitly');
  }
  const tlsRequired = transportMode === 'lan' && env.READY4VIBE_ALLOW_INSECURE_LAN !== '1';
  const tlsEnabled = tlsRequired || env.READY4VIBE_TLS_ENABLED === '1';
  const certificatePaths = resolveTlsCertificatePaths(env);
  return {
    host,
    transportMode,
    tlsRequired,
    tlsEnabled,
    ...(certificatePaths ? { certificatePaths } : {}),
  };
}
