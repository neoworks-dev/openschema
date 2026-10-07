// src/emit/descriptor/errors.ts
// Constructs the descriptor target rejects. Emitters have no diagnostics
// channel, so the emitter throws and the CLI renders it like a diagnostic.
export class DescriptorError extends Error {
    constructor(code, model, field, reason, span) {
        super(formatMessage(model, field, reason));
        this.code = code;
        this.model = model;
        this.field = field;
        this.reason = reason;
        this.span = span;
        this.name = "DescriptorError";
    }
}
function formatMessage(model, field, reason) {
    if (field === null)
        return `${model}: ${reason}`;
    return `${model}.${field}: ${reason}`;
}
//# sourceMappingURL=errors.js.map