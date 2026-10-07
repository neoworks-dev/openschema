export interface Endpoints {
    /** neoworks API base (hosts the registry at /api/v1/schemas). */
    api: string;
    /** OAuth server (authorize + token). */
    oauth: string;
    /** The openschema site (hosts the /publish endpoint). */
    site: string;
}
export declare function resolveEndpoints(overrides?: {
    baseDomain?: string;
    scheme?: string;
}): Endpoints;
//# sourceMappingURL=urls.d.ts.map