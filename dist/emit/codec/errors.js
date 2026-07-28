// src/emit/codec/errors.ts
// Constructs the codec cannot encode. Emitters have no diagnostics channel, so
// the codec emitter throws and the CLI renders it like a resolver diagnostic.
export class CodecUnsupportedError extends Error {
    constructor(code, model, field, reason, span) {
        super(formatMessage(model, field, reason));
        this.code = code;
        this.model = model;
        this.field = field;
        this.reason = reason;
        this.span = span;
        this.name = "CodecUnsupportedError";
    }
}
function formatMessage(model, field, reason) {
    if (field === null)
        return `${model}: ${reason}`;
    return `${model}.${field}: ${reason}`;
}
//# sourceMappingURL=errors.js.map