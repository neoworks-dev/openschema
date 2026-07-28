// src/emit/index.ts
// Emitter registry. Look up an emitter by target name.
import { sqlEmitter } from "./sql/sqlEmitter.js";
import { typescriptEmitter } from "./typescript/typescriptEmitter.js";
import { jsonSchemaEmitter } from "./jsonSchema/jsonSchemaEmitter.js";
import { goEmitter } from "./go/goEmitter.js";
import { graphqlEmitter } from "./graphql/graphqlEmitter.js";
import { openApiEmitter } from "./openapi/openApiEmitter.js";
import { surrealEmitter } from "./surrealdb/surrealEmitter.js";
import { zodEmitter } from "./zod/zodEmitter.js";
import { internalEmitter } from "./internal/internalEmitter.js";
import { neoworksDdlEmitter } from "./neoworks/neoworksDdlEmitter.js";
import { codecEmitter } from "./codec/codecEmitter.js";
const EMITTERS = {
    [sqlEmitter.target]: sqlEmitter,
    [typescriptEmitter.target]: typescriptEmitter,
    [jsonSchemaEmitter.target]: jsonSchemaEmitter,
    [goEmitter.target]: goEmitter,
    [graphqlEmitter.target]: graphqlEmitter,
    [openApiEmitter.target]: openApiEmitter,
    [surrealEmitter.target]: surrealEmitter,
    [zodEmitter.target]: zodEmitter,
    [internalEmitter.target]: internalEmitter,
    [neoworksDdlEmitter.target]: neoworksDdlEmitter,
    [codecEmitter.target]: codecEmitter,
};
export function getEmitter(target) {
    return EMITTERS[target] ?? null;
}
export function listTargets() {
    return Object.keys(EMITTERS);
}
//# sourceMappingURL=index.js.map