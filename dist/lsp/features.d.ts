import type { Hover, Location, CompletionItem, Position } from "vscode-languageserver";
import type { Program } from "../parser/ast.js";
import type { ResolvedSchema } from "../resolver/types.js";
export declare function hover(text: string, position: Position, schema: ResolvedSchema | null): Hover | null;
export type ModuleTextProvider = (moduleId: string) => string | null;
export declare function definition(text: string, position: Position, schema: ResolvedSchema | null, entryUri: string, moduleText: ModuleTextProvider): Location | null;
export declare function references(text: string, position: Position, schema: ResolvedSchema | null, program: Program | null, entryUri: string, includeDeclaration: boolean): Location[];
export declare function completion(text: string, position: Position, schema: ResolvedSchema | null): CompletionItem[];
//# sourceMappingURL=features.d.ts.map