// src/registry/urls.ts
// Every neoworks service URL derives from one base domain (prod: neoworks.dev,
// dev: neoworks.localhost), mirroring the SDK's neoworksUrls(). The CLI resolves
// the registry (data plane), oauth, and the openschema site from that base.

const DEFAULT_BASE_DOMAIN = 'neoworks.dev';
const DEFAULT_SCHEME = 'https';

export interface Endpoints {
  /** neoworks API base (hosts the data plane at /graphql/db/...). */
  api: string;
  /** OAuth server (authorize + token). */
  oauth: string;
  /** The openschema site (hosts the /publish endpoint). */
  site: string;
}

export function resolveEndpoints(overrides?: { baseDomain?: string; scheme?: string }): Endpoints {
  const base = overrides?.baseDomain || process.env.OPENSCHEMA_BASE_DOMAIN || DEFAULT_BASE_DOMAIN;
  const scheme = overrides?.scheme || process.env.OPENSCHEMA_SCHEME || DEFAULT_SCHEME;
  const at = (subdomain: string) => `${scheme}://${subdomain}.${base}`;
  return {
    api: process.env.OPENSCHEMA_REGISTRY || at('api'),
    oauth: process.env.OPENSCHEMA_OAUTH_URL || at('oauth'),
    site: process.env.OPENSCHEMA_SITE_URL || at('openschema')
  };
}
