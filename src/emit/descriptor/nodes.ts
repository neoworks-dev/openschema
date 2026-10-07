// src/emit/descriptor/nodes.ts
// The Neoworks node extension. A model marked @neoworks.node("item") is the
// content of every item node in the collection the schema is published as.
// Its fields are split into facets, each encrypted under its own key so a grant
// can cover only some of them; fields without @neoworks.facet share the
// default facet.

import { createHash } from "node:crypto";
import type { Decorator } from "../../parser/ast.js";
import type { ResolvedModel, ResolvedSchema } from "../../resolver/types.js";
import { allDecorators, firstStringArg, namedStringArg } from "../typeMapping.js";
import { MAX_ORDINAL } from "../codec/wireFormat.js";
import type {
  FacetDescriptor, FieldDescriptor, ModelDescriptor, NodeDescriptor, NodeKind, TimeRangeDescriptor,
} from "./descriptorTypes.js";
import { DescriptorError } from "./errors.js";

export const DEFAULT_FACET = "default";
export const DEFAULT_FACET_TAG = 1;

const NODE_DECORATOR = "neoworks.node";
const FACET_DECORATOR = "neoworks.facet";
const SEARCHABLE_DECORATOR = "neoworks.searchable";
const TIME_RANGE_DECORATOR = "neoworks.timeRange";
const TITLE_DECORATOR = "neoworks.title";
const KNOWN_DECORATORS = new Set([
  NODE_DECORATOR, FACET_DECORATOR, SEARCHABLE_DECORATOR, TIME_RANGE_DECORATOR, TITLE_DECORATOR,
]);
// Roots carry no content: the collection's name comes from the registry title.
const NODE_KINDS: ReadonlySet<string> = new Set<NodeKind>(["container", "item"]);
const FACET_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** `models` must hold one descriptor per record, under the record's local name. */
export function describeNodes(schema: ResolvedSchema, models: Map<string, ModelDescriptor>): NodeDescriptor[] {
  const nodes: NodeDescriptor[] = [];
  const modelByKind = new Map<NodeKind, string>();

  for (const record of schema.records.values()) {
    rejectUnknownDecorators(record);
    const model = models.get(record.symbol.localName);
    if (model === undefined) continue;
    const kind = nodeKindOf(record);
    if (kind === null) {
      rejectNodeOnlyDecorators(record);
      continue;
    }
    rejectDuplicateKind(modelByKind, kind, record);
    nodes.push(describeNode(record, model, kind));
  }
  return nodes;
}

/**
 * The facet's tag, derived from its name so the name stays the identity without
 * a registry of numbers. Tag 1 is the default facet; the overlay envelope tag
 * (MAX_ORDINAL) is never produced.
 */
export function facetTag(name: string): number {
  if (name === DEFAULT_FACET) return DEFAULT_FACET_TAG;
  const digest = createHash("sha256").update(`neoworks.facet:${name}`).digest();
  return 2 + (digest.readUInt32BE(0) % (MAX_ORDINAL - 2));
}

/** The facet a field's @neoworks.facet names, or the default facet. */
export function facetNameOf(decorators: Decorator[]): string {
  const name = firstStringArg(decorators, FACET_DECORATOR);
  if (name === null) return DEFAULT_FACET;
  return name;
}

function describeNode(record: ResolvedModel, model: ModelDescriptor, kind: NodeKind): NodeDescriptor {
  const facetByOrdinal = assignFacets(record, model);
  return {
    kind,
    model: model.name,
    facets: groupFacets(record, model, facetByOrdinal),
    searchable: searchableFields(record, model),
    title: titleField(record, model),
    timeRange: describeTimeRange(record, model, facetByOrdinal),
  };
}

// ── Node kind ─────────────────────────────────────────────────────────────────

function nodeKindOf(record: ResolvedModel): NodeKind | null {
  const decorators = allDecorators(record.decorators, NODE_DECORATOR);
  if (decorators.length === 0) return null;
  const kind = firstStringArg(decorators, NODE_DECORATOR);
  if (decorators.length > 1 || kind === null || !NODE_KINDS.has(kind)) {
    throw new DescriptorError("OSD002", record.symbol.localName, null,
      `@${NODE_DECORATOR} takes one of "container" or "item", once`, decorators[0].span);
  }
  return kind as NodeKind;
}

function rejectDuplicateKind(modelByKind: Map<NodeKind, string>, kind: NodeKind, record: ResolvedModel): void {
  const existing = modelByKind.get(kind);
  if (existing !== undefined) {
    throw new DescriptorError("OSD003", record.symbol.localName, null,
      `'${existing}' is already the ${kind} node model; a schema has at most one model per node kind`,
      record.symbol.span);
  }
  modelByKind.set(kind, record.symbol.localName);
}

// ── Decorator placement ───────────────────────────────────────────────────────

function rejectUnknownDecorators(record: ResolvedModel): void {
  const decorators = [...record.decorators, ...record.fields.flatMap(field => field.decorators)];
  for (const decorator of decorators) {
    if (decorator.path[0] !== "neoworks" || KNOWN_DECORATORS.has(decorator.name)) continue;
    throw new DescriptorError("OSD001", record.symbol.localName, null,
      `unknown decorator @${decorator.name}`, decorator.span);
  }
}

/** Facets and indexes only mean something on a node model; elsewhere they would be silently ignored. */
function rejectNodeOnlyDecorators(record: ResolvedModel): void {
  const misplaced = [
    ...allDecorators(record.decorators, TIME_RANGE_DECORATOR),
    ...record.fields.flatMap(field => [
      ...allDecorators(field.decorators, FACET_DECORATOR),
      ...allDecorators(field.decorators, SEARCHABLE_DECORATOR),
      ...allDecorators(field.decorators, TITLE_DECORATOR),
    ]),
  ];
  if (misplaced.length === 0) return;
  throw new DescriptorError("OSD004", record.symbol.localName, null,
    `@${misplaced[0].name} is only valid on a model marked @${NODE_DECORATOR}`, misplaced[0].span);
}

// ── Facets ────────────────────────────────────────────────────────────────────

function assignFacets(record: ResolvedModel, model: ModelDescriptor): Map<number, string> {
  const facetByOrdinal = new Map<number, string>();
  for (const field of model.fields) {
    facetByOrdinal.set(field.ordinal, readFacetName(record, field));
  }
  return facetByOrdinal;
}

function readFacetName(record: ResolvedModel, field: FieldDescriptor): string {
  const decorators = allDecorators(decoratorsOf(record, field), FACET_DECORATOR);
  if (decorators.length === 0) return DEFAULT_FACET;
  const name = firstStringArg(decorators, FACET_DECORATOR);
  const valid = decorators.length === 1 && name !== null && FACET_NAME.test(name);
  if (!valid || name.toLowerCase() === DEFAULT_FACET) {
    throw new DescriptorError("OSD005", record.symbol.localName, field.name,
      `@${FACET_DECORATOR} takes one name of letters and digits, starting with a letter, ` +
      `other than "${DEFAULT_FACET}"`, decorators[0].span);
  }
  return name;
}

function groupFacets(record: ResolvedModel, model: ModelDescriptor, facetByOrdinal: Map<number, string>): FacetDescriptor[] {
  const facets = new Map<string, FacetDescriptor>();
  for (const field of model.fields) {
    const name = facetByOrdinal.get(field.ordinal) as string;
    let facet = facets.get(name);
    if (facet === undefined) {
      facet = { name, tag: facetTag(name), fields: [] };
      facets.set(name, facet);
    }
    facet.fields.push(field.ordinal);
  }
  const grouped = [...facets.values()].sort((left, right) => left.tag - right.tag);
  rejectTagCollisions(record, grouped);
  return grouped;
}

function rejectTagCollisions(record: ResolvedModel, facets: FacetDescriptor[]): void {
  for (let index = 1; index < facets.length; index++) {
    if (facets[index].tag !== facets[index - 1].tag) continue;
    throw new DescriptorError("OSD006", record.symbol.localName, null,
      `facets '${facets[index - 1].name}' and '${facets[index].name}' derive the same tag; rename one`,
      record.symbol.span);
  }
}

// ── Indexes ───────────────────────────────────────────────────────────────────

function searchableFields(record: ResolvedModel, model: ModelDescriptor): number[] {
  const ordinals: number[] = [];
  for (const field of model.fields) {
    const decorators = allDecorators(decoratorsOf(record, field), SEARCHABLE_DECORATOR);
    if (decorators.length === 0) continue;
    if (!isStringField(field)) {
      throw new DescriptorError("OSD007", record.symbol.localName, field.name,
        `@${SEARCHABLE_DECORATOR} applies to string and [string] fields only`, decorators[0].span);
    }
    ordinals.push(field.ordinal);
  }
  return ordinals;
}

/** The single string field that names the node, if the model marks one. */
function titleField(record: ResolvedModel, model: ModelDescriptor): number | null {
  const marked = model.fields.filter(field => allDecorators(decoratorsOf(record, field), TITLE_DECORATOR).length > 0);
  if (marked.length === 0) return null;
  const field = marked[0];
  const singularString = field.container.kind === "singular" &&
    field.value.kind === "scalar" && field.value.scalar === "string";
  if (marked.length > 1 || !singularString) {
    throw new DescriptorError("OSD010", record.symbol.localName, field.name,
      `@${TITLE_DECORATOR} marks exactly one single string field per model`, null);
  }
  return field.ordinal;
}

function isStringField(field: FieldDescriptor): boolean {
  if (field.value.kind !== "scalar" || field.value.scalar !== "string") return false;
  return field.container.kind !== "map" && field.container.kind !== "wrapperMap";
}

function describeTimeRange(
  record: ResolvedModel,
  model: ModelDescriptor,
  facetByOrdinal: Map<number, string>,
): TimeRangeDescriptor | null {
  const decorators = allDecorators(record.decorators, TIME_RANGE_DECORATOR);
  if (decorators.length === 0) return null;
  const fail = (reason: string): never => {
    throw new DescriptorError("OSD008", record.symbol.localName, null, reason, decorators[0].span);
  };
  if (decorators.length > 1) fail(`@${TIME_RANGE_DECORATOR} may appear once per model`);

  const start = timestampField(model, namedStringArg(decorators, TIME_RANGE_DECORATOR, "start"), fail);
  const end = timestampField(model, namedStringArg(decorators, TIME_RANGE_DECORATOR, "end"), fail);
  if (facetByOrdinal.get(start.ordinal) !== facetByOrdinal.get(end.ordinal)) {
    fail(`'${start.name}' and '${end.name}' must be in the same facet`);
  }
  return { start: start.ordinal, end: end.ordinal };
}

function timestampField(
  model: ModelDescriptor,
  name: string | null,
  fail: (reason: string) => never,
): FieldDescriptor {
  if (name === null) fail(`@${TIME_RANGE_DECORATOR} needs start: "<field>" and end: "<field>"`);
  const field = model.fields.find(candidate => candidate.name === name);
  if (field === undefined) fail(`'${name}' is not a field of ${model.name}`);
  const singularTimestamp = field.container.kind === "singular" &&
    field.value.kind === "scalar" && field.value.scalar === "timestamp";
  if (!singularTimestamp) fail(`'${name}' must be a single timestamp`);
  return field;
}

function decoratorsOf(record: ResolvedModel, field: FieldDescriptor): Decorator[] {
  const resolved = record.fields.find(candidate => candidate.ordinal === field.ordinal);
  if (resolved === undefined) return [];
  return resolved.decorators;
}
