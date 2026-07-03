import * as AST from "../parser/ast.js";
import type { DiffResult } from "./types.js";
export declare class Differ {
    private changes;
    diff(oldProg: AST.Program, newProg: AST.Program): DiffResult;
    private diffPrograms;
    private diffRecords;
    private diffFieldConstraints;
    private diffAddedField;
    private diffFieldTypes;
    private diffEnums;
    private emit;
}
//# sourceMappingURL=differ.d.ts.map