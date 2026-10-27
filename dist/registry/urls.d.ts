export interface Endpoints {
    /** neoworks API base (hosts the registry at /api/v1/schemas). */
    api: string;
    /** OAuth server (authorize + token). */
    oauth: string;
}
export interface EndpointOverrides {
    baseDomain?: string;
    scheme?: string;
    /** Port shared by all services, e.g. 8443 for `*.neoworks.localhost:8443`. */
    port?: string;
}
/** A base port is a number of 1 to 65535; anything else is a mistake worth stopping on. */
export declare function validateBasePort(port: string): string;
export declare function resolveEndpoints(overrides?: EndpointOverrides): Endpoints;
//# sourceMappingURL=urls.d.ts.map