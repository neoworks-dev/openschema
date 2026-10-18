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
import { codecEmitter } from "./codec/codecEmitter.js";
import { descriptorEmitter } from "./descriptor/descriptorEmitter.js";
import { collectionEmitter } from "./collection/collectionEmitter.js";
import { kotlinEmitter } from "./kotlin/kotlinEmitter.js";
import { versionsEmitter } from "./versions/versionsEmitter.js";
const EMITTERS = {
    [sqlEmitter.target]: sqlEmitter,
    [typescriptEmitter.target]: typescriptEmitter,
    [jsonSchemaEmitter.target]: jsonSchemaEmitter,
    [goEmitter.target]: goEmitter,
    [graphqlEmitter.target]: graphqlEmitter,
    [openApiEmitter.target]: openApiEmitter,
    [surrealEmitter.target]: surrealEmitter,
    [zodEmitter.target]: zodEmitter,
    [codecEmitter.target]: codecEmitter,
    [descriptorEmitter.target]: descriptorEmitter,
    [collectionEmitter.target]: collectionEmitter,
    [versionsEmitter.target]: versionsEmitter,
    [kotlinEmitter.target]: kotlinEmitter,
};
export function getEmitter(target) {
    return EMITTERS[target] ?? null;
}
export function listTargets() {
    return Object.keys(EMITTERS);
}
//# sourceMappingURL=index.js.map