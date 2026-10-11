// src/registry/urls.ts
// Every neoworks service URL derives from one base domain (prod: neoworks.dev,
// dev: neoworks.localhost) and, for a dev stack behind a proxy, one base port,
// mirroring the SDK's neoworksUrls(). The CLI resolves the registry (api),
// oauth, and the openschema site from that base.

const DEFAULT_BASE_DOMAIN = 'neoworks.dev';
const DEFAULT_SCHEME = 'https';

export interface Endpoints {
  /** neoworks API base (hosts the registry at /api/v1/schemas). */
  api: string;
  /** OAuth server (authorize + token). */
  oauth: string;
  /** The openschema site (hosts the /publish endpoint). */
  site: string;
}

export interface EndpointOverrides {
  baseDomain?: string;
  scheme?: string;
  /** Port shared by all services, e.g. 8443 for `*.neoworks.localhost:8443`. */
  port?: string;
}

/** `:port`, or an empty string when the port is empty or the scheme's default. */
function portSuffix(scheme: string, port: string): string {
  if (port === '') {
    return '';
  }
  if (scheme === 'https' && port === '443') {
    return '';
  }
  if (scheme === 'http' && port === '80') {
    return '';
  }
  return `:${port}`;
}

/** The first of the explicit value, the environment variable and the fallback that is set. */
function firstSet(explicit: string | undefined, environment: string | undefined, fallback: string): string {
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }
  if (environment !== undefined && environment !== '') {
    return environment;
  }
  return fallback;
}

/** A base port is a number of 1 to 65535; anything else is a mistake worth stopping on. */
export function validateBasePort(port: string): string {
  const number = Number(port);
  if (port === '' || !Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`invalid base port "${port}": expected a number from 1 to 65535`);
  }
  return port;
}

export function resolveEndpoints(overrides: EndpointOverrides = {}): Endpoints {
  const base = firstSet(overrides.baseDomain, process.env.OPENSCHEMA_BASE_DOMAIN, DEFAULT_BASE_DOMAIN);
  const scheme = firstSet(overrides.scheme, process.env.OPENSCHEMA_SCHEME, DEFAULT_SCHEME);
  const port = firstSet(overrides.port, process.env.OPENSCHEMA_BASE_PORT, '');
  if (port !== '') {
    validateBasePort(port);
  }
  const suffix = portSuffix(scheme, port);
  const at = (subdomain: string) => `${scheme}://${subdomain}.${base}${suffix}`;
  return {
    api: process.env.OPENSCHEMA_REGISTRY || at('api'),
    oauth: process.env.OPENSCHEMA_OAUTH_URL || at('oauth'),
    site: process.env.OPENSCHEMA_SITE_URL || at('openschema')
  };
}
