export interface VocabularyEntry {
    label: string;
    detail: string;
    documentation: string;
}
export declare const SCALAR_TYPES: VocabularyEntry[];
export declare const KEYWORDS: VocabularyEntry[];
export declare const DECORATORS: VocabularyEntry[];
export declare const DECORATOR_ARG_VALUES: Record<string, VocabularyEntry[]>;
export declare function findScalar(label: string): VocabularyEntry | null;
export declare function findDecorator(name: string): VocabularyEntry | null;
/** Documentation for a known value of a specific decorator's argument. */
export declare function findArgValue(decoratorName: string, value: string): VocabularyEntry | null;
//# sourceMappingURL=vocabulary.d.ts.map