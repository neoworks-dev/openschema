import { Token, TokenKind } from "./tokens.js";
/** Whether a token kind is a keyword word (`date`, `type`, `model`, …). */
export declare function isKeywordToken(kind: TokenKind): boolean;
export declare class LexError extends Error {
    readonly line: number;
    readonly col: number;
    constructor(message: string, line: number, col: number);
}
export declare class Lexer {
    private readonly source;
    private pos;
    private line;
    private col;
    private tokens;
    constructor(source: string);
    tokenize(): Token[];
    private ch;
    private advance;
    private push;
    private skipWhitespaceAndComments;
    private readToken;
    private lexString;
    private lexNumber;
    private lexWord;
    private lexEscapedIdent;
}
//# sourceMappingURL=lexer.d.ts.map