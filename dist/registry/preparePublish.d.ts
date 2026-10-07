import type { PublishPayload } from "./client.js";
export type PreparedPublish = {
    payload: PublishPayload;
    problems: [];
} | {
    payload: null;
    problems: string[];
};
export declare function preparePublish(directory: string, generator: string): PreparedPublish;
//# sourceMappingURL=preparePublish.d.ts.map