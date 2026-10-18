/** Kotlin names the schema may not use as they are written in backticks. */
export declare function identifier(name: string): string;
export declare function capitalize(name: string): string;
/** `google-calendar` is `GoogleCalendar`. */
export declare function pascalCase(name: string): string;
/** The name segment of `@scope/name` as a package segment: lower case letters and digits only. */
export declare function packageSegment(collectionName: string): string;
/** The directory of a package inside a source root. */
export declare function packageDirectory(packageName: string): string;
//# sourceMappingURL=kotlinNames.d.ts.map