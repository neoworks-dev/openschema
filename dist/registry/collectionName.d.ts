export interface CollectionIdentity {
    name: string;
    version: string;
}
/** Throws with the reason when the directory has no valid manifest. */
export declare function readCollectionIdentity(directory: string): CollectionIdentity;
/** Null when the directory has no manifest; throws with the reason when the manifest is invalid. */
export declare function findCollectionIdentity(directory: string): CollectionIdentity | null;
/** The version in the directory's manifest; null when there is none or it has problems. */
export declare function readManifestVersion(directory: string): string | null;
//# sourceMappingURL=collectionName.d.ts.map