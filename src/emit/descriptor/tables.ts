// src/emit/descriptor/tables.ts
// The Neoworks table extension. A model marked @neoworks.table is stored as rows
// of the collection the schema is published as; a collection holds any number of
// tables. A row's fields are split into facets, each encrypted under its own key
// so a grant can cover only some of them; fields without @neoworks.facet share the
// default facet. A `ref<Table>` field links a row to another row, and @belongsTo
// on one of them makes the row part of its target.

import { createHash } from "node:crypto";
import type { Decorator } from "../../parser/ast.js";
import type { ResolvedModel, ResolvedSchema } from "../../resolver/types.js";
import { allDecorators, firstStringArg, namedStringArg } from "../typeMapping.js";
import { MAX_ORDINAL } from "../codec/wireFormat.js";
import type {
  FacetDescriptor, FieldDescriptor, ModelDescriptor, TableDescriptor, TimeRangeDescriptor,
} from "./descriptorTypes.js";
import { DescriptorError } from "./errors.js";

export const DEFAULT_FACET = "default";
export const DEFAULT_FACET_TAG = 1;
export const TABLE_DECORATOR = "neoworks.table";

const RETIRED_NODE_DECORATOR = "neoworks.node";
const FACET_DECORATOR = "neoworks.facet";
const SEARCHABLE_DECORATOR = "neoworks.searchable";
const TIME_RANGE_DECORATOR = "neoworks.timeRange";
const TITLE_DECORATOR = "neoworks.title";
const BELONGS_TO_DECORATOR = "belongsTo";
const ON_DELETE_DECORATOR = "onDelete";
const CASCADE = "cascade";
const KNOWN_DECORATORS = new Set([
  TABLE_DECORATOR, FACET_DECORATOR, SEARCHABLE_DECORATOR, TIME_RANGE_DECORATOR, TITLE_DECORATOR,
]);
const FACET_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** `models` must hold one descriptor per record, under the record's local name. */
export function describeTables(schema: ResolvedSchema, models: Map<string, ModelDescriptor>): TableDescriptor[] {
  const tables: TableDescriptor[] = [];
  const tableNames = tableNamesOf(schema);
  for (const record of schema.records.values()) {
    rejectUnknownDecorators(record);
    const model = models.get(record.symbol.localName);
    if (model === undefined) continue;
    if (!isTable(record)) {
      rejectTableOnlyDecorators(record);
      continue;
    }
    tables.push(describeTable(record, model, tableNames));
  }
  return tables;
}

/** Whether the model is marked @neoworks.table, rejecting a marker that carries arguments or repeats. */
export function isTable(record: ResolvedModel): boolean {
  const decorators = allDecorators(record.decorators, TABLE_DECORATOR);
  if (decorators.length === 0) return false;
  if (decorators.length > 1 || decorators[0].args.length > 0) {
    throw new DescriptorError("OSD002", record.symbol.localName, null,
      `@${TABLE_DECORATOR} takes no arguments and appears once`, decorators[0].span);
  }
  return true;
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

function describeTable(record: ResolvedModel, model: ModelDescriptor, tableNames: Set<string>): TableDescriptor {
  const facetByOrdinal = assignFacets(record, model);
  return {
    model: model.name,
    facets: groupFacets(record, model, facetByOrdinal),
    searchable: searchableFields(record, model),
    title: titleField(record, model),
    timeRange: describeTimeRange(record, model, facetByOrdinal),
    belongsTo: belongsToField(record, model, tableNames),
    cascade: cascadeFields(record, model),
  };
}

/** The qualified names of this schema's tables, which a @belongsTo may name. */
function tableNamesOf(schema: ResolvedSchema): Set<string> {
  const names = new Set<string>();
  for (const record of schema.records.values()) {
    if (allDecorators(record.decorators, TABLE_DECORATOR).length > 0) names.add(record.symbol.qualifiedName);
  }
  return names;
}

// ── Decorator placement ───────────────────────────────────────────────────────

function rejectUnknownDecorators(record: ResolvedModel): void {
  const decorators = [...record.decorators, ...record.fields.flatMap(field => field.decorators)];
  for (const decorator of decorators) {
    if (decorator.name === RETIRED_NODE_DECORATOR) {
      throw new DescriptorError("OSD001", record.symbol.localName, null,
        `@${RETIRED_NODE_DECORATOR} is replaced by @${TABLE_DECORATOR}`, decorator.span);
    }
    if (decorator.path[0] !== "neoworks" || KNOWN_DECORATORS.has(decorator.name)) continue;
    throw new DescriptorError("OSD001", record.symbol.localName, null,
      `unknown decorator @${decorator.name}`, decorator.span);
  }
}

/** Facets, indexes and relations only mean something on a table; elsewhere they would be silently ignored. */
function rejectTableOnlyDecorators(record: ResolvedModel): void {
  const misplaced = [
    ...allDecorators(record.decorators, TIME_RANGE_DECORATOR),
    ...record.fields.flatMap(field => [
      ...allDecorators(field.decorators, FACET_DECORATOR),
      ...allDecorators(field.decorators, SEARCHABLE_DECORATOR),
      ...allDecorators(field.decorators, TITLE_DECORATOR),
      ...allDecorators(field.decorators, BELONGS_TO_DECORATOR),
      ...allDecorators(field.decorators, ON_DELETE_DECORATOR),
    ]),
  ];
  if (misplaced.length === 0) return;
  throw new DescriptorError("OSD004", record.symbol.localName, null,
    `@${misplaced[0].name} is only valid on a model marked @${TABLE_DECORATOR}`, misplaced[0].span);
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

/**
 * Every table has the default facet, even with all its fields in named ones: each
 * facet names the row's table, and a row always carries its default facet.
 */
function groupFacets(record: ResolvedModel, model: ModelDescriptor, facetByOrdinal: Map<number, string>): FacetDescriptor[] {
  const facets = new Map<string, FacetDescriptor>();
  facets.set(DEFAULT_FACET, { name: DEFAULT_FACET, tag: DEFAULT_FACET_TAG, fields: [] });
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
    if (!isTextField(field)) {
      throw new DescriptorError("OSD007", record.symbol.localName, field.name,
        `@${SEARCHABLE_DECORATOR} applies to string, [string], File and [File] fields only`, decorators[0].span);
    }
    ordinals.push(field.ordinal);
  }
  return ordinals;
}

/** The single string or File field that names the row (a File by its name), if the table marks one. */
function titleField(record: ResolvedModel, model: ModelDescriptor): number | null {
  const marked = model.fields.filter(field => allDecorators(decoratorsOf(record, field), TITLE_DECORATOR).length > 0);
  if (marked.length === 0) return null;
  const field = marked[0];
  if (marked.length > 1 || field.container.kind !== "singular" || !isTextValue(field)) {
    throw new DescriptorError("OSD010", record.symbol.localName, field.name,
      `@${TITLE_DECORATOR} marks exactly one single string or File field per table`, null);
  }
  return field.ordinal;
}

/** A string, or a File, whose text is its name. */
function isTextValue(field: FieldDescriptor): boolean {
  if (field.value.kind === "file") return true;
  return field.value.kind === "scalar" && field.value.scalar === "string";
}

function isTextField(field: FieldDescriptor): boolean {
  if (!isTextValue(field)) return false;
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

// ── Relations ─────────────────────────────────────────────────────────────────

/** The one single reference to a table of this schema that marks what the row belongs to. */
function belongsToField(record: ResolvedModel, model: ModelDescriptor, tableNames: Set<string>): number | null {
  const marked = model.fields.filter(field => markedWith(record, field, BELONGS_TO_DECORATOR).length > 0);
  if (marked.length === 0) return null;
  const field = marked[0];
  const decorator = markedWith(record, field, BELONGS_TO_DECORATOR)[0];
  const fail = (reason: string): never => {
    throw new DescriptorError("OSD011", record.symbol.localName, field.name, reason, decorator.span);
  };
  if (marked.length > 1) fail(`@${BELONGS_TO_DECORATOR} marks at most one field per table`);
  if (decorator.args.length > 0 || markedWith(record, field, BELONGS_TO_DECORATOR).length > 1) {
    fail(`@${BELONGS_TO_DECORATOR} takes no arguments and appears once`);
  }
  if (field.container.kind !== "singular" || field.value.kind !== "ref") {
    fail(`@${BELONGS_TO_DECORATOR} applies to a single ref<Table> field`);
  }
  if (!tableNames.has(referencedModel(field))) {
    fail(`@${BELONGS_TO_DECORATOR} must name a table of this schema`);
  }
  if (markedWith(record, field, ON_DELETE_DECORATOR).length > 0) {
    fail(`a row is deleted with what it belongs to; @${ON_DELETE_DECORATOR} does not apply`);
  }
  return field.ordinal;
}

function cascadeFields(record: ResolvedModel, model: ModelDescriptor): number[] {
  const ordinals: number[] = [];
  for (const field of model.fields) {
    const decorators = markedWith(record, field, ON_DELETE_DECORATOR);
    if (decorators.length === 0) continue;
    const isReference = field.value.kind === "ref" && field.container.kind !== "map" && field.container.kind !== "wrapperMap";
    const action = firstStringArg(decorators, ON_DELETE_DECORATOR);
    if (decorators.length > 1 || decorators[0].args.length !== 1 || action !== CASCADE || !isReference) {
      throw new DescriptorError("OSD012", record.symbol.localName, field.name,
        `@${ON_DELETE_DECORATOR}("${CASCADE}") applies once to a ref<Table> or [ref<Table>] field`, decorators[0].span);
    }
    ordinals.push(field.ordinal);
  }
  return ordinals;
}

function referencedModel(field: FieldDescriptor): string {
  if (field.value.kind !== "ref") return "";
  return field.value.model;
}

function markedWith(record: ResolvedModel, field: FieldDescriptor, decoratorName: string): Decorator[] {
  return allDecorators(decoratorsOf(record, field), decoratorName);
}

function decoratorsOf(record: ResolvedModel, field: FieldDescriptor): Decorator[] {
  const resolved = record.fields.find(candidate => candidate.ordinal === field.ordinal);
  if (resolved === undefined) return [];
  return resolved.decorators;
}
