/**
 * "sha256-" and the hex SHA-256 over the files in the registry's order, each
 * written as the byte length of its path, ':', the path, the byte length of its
 * contents, ':', and the contents.
 */
export declare function schemaIntegrity(files: {
    path: string;
    contents: string;
}[]): string;
//# sourceMappingURL=integrity.d.ts.map