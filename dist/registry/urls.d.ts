export interface Endpoints {
    /** neoworks API base (hosts the data plane at /graphql/db/...). */
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