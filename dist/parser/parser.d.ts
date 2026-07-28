import { Token } from "../lexer/tokens.js";
import * as AST from "./ast.js";
export declare class ParseError extends Error {
    readonly token: Token;
    constructor(message: string, token: Token);
}
export declare class Parser {
    private readonly tokens;
    private pos;
    constructor(tokens: Token[]);
    parse(): AST.Program;
    private parseDeclaration;
    private parseLeadingMetadata;
    private rejectMetadata;
    /** `namespace` carries directives (e.g. #requireLedger) but never decorators. */
    private rejectDecorators;
    private parseDecorator;
    private parseDecoratorArg;
    private parseDecoratorValue;
    private normalizeDecoratorValue;
    private parseDirective;
    private parseNamespace;
    private parseImport;
    private parseTypeAlias;
    private parseModel;
    private parseTypeParams;
    private parseTypeArgs;
    private lastDocComment;
    private parseField;
    private parseEnum;
    private parseDecorators;
    private parseOperation;
    private parseParam;
    private parseOverlay;
    private atReservedDeclaration;
    private parseReserved;
    private parseReservedRange;
    private expectContextual;
    private parseInterface;
    private expectNameSegment;
    private parseTypeExpr;
    private parseUnionType;
    private parseNullableType;
    private parsePrimaryType;
    private parsePrimaryTypeInner;
    private parseExpr;
    private parseOrExpr;
    private parseAndExpr;
    private parseEqExpr;
    private parseRelExpr;
    private parseAddExpr;
    private parseMulExpr;
    private parseUnaryExpr;
    private parsePrimaryExpr;
    private parseQualifiedIdent;
    private peek;
    private peekAt;
    private advance;
    private at;
    private expect;
    /** Expect an Ident token; `role` is used only in error messages. */
    private expectIdent;
    private parseArrayBounds;
    private expectInt;
    private expectString;
    /** Capture the current line/col as a Span before consuming tokens. */
    private span;
}
//# sourceMappingURL=parser.d.ts.map