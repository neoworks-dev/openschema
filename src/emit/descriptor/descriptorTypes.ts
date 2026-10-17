// src/emit/descriptor/descriptorTypes.ts
// The `descriptor` target's output: a schema compiled for runtimes that encode,
// decode and validate without generated code. Field references are ordinals, not
// names, so a rename never changes what a reference points at.

import type { Container, ValueShape } from "../codec/plan.js";

export const DESCRIPTOR_VERSION = 2;

export interface SchemaDescriptor {
  descriptorVersion: number;
  namespace:         string;
  enums:             EnumDescriptor[];
  models:            ModelDescriptor[];
  tables:            TableDescriptor[];
}

export interface EnumDescriptor {
  name:     string;
  variants: EnumVariantDescriptor[];
}

export interface EnumVariantDescriptor {
  name:    string;
  ordinal: number;
}

export interface ModelDescriptor {
  name:   string;
  fields: FieldDescriptor[];
}

export interface FieldDescriptor {
  ordinal:     number;
  name:        string;
  container:   Container;
  value:       ValueShape;
  /** A decoder must reject the message when this field is absent. */
  required:    boolean;
  /** Applies to every value: each element of a list, each value of a map. */
  constraints: ValueConstraints;
}

export interface ValueConstraints {
  minValue?:  number;
  maxValue?:  number;
  minLength?: number;
  maxLength?: number;
  /** ECMAScript regular expression; the whole value must match. */
  pattern?:   string;
  format?:    string;
}

/**
 * A model stored as rows of a Neoworks collection, marked @neoworks.table. Every
 * row names its table inside each facet's plaintext, so one collection holds rows
 * of any number of tables.
 */
export interface TableDescriptor {
  model:      string;
  facets:     FacetDescriptor[];
  /** Ordinal of the string or File field that names the row, from @neoworks.title. */
  title:      number | null;
  /** Ordinal of the @belongsTo reference the row's key is wrapped under; null for rows under the collection root. */
  belongsTo:  number | null;
  /** Ordinals of the references marked @onDelete("cascade"): deleting the target deletes the row. */
  cascade:    number[];
  /** Sorted indexes a client keeps on its device: the @belongsTo field's, and those from @neoworks.index. */
  indexes:    IndexDescriptor[];
}

/** A sorted index over single values: queries use it for equality and range filters on its leading fields and for ordering by them. */
export interface IndexDescriptor {
  /** Field ordinals, leading field first. */
  fields: number[];
}

/** A separately encrypted group of a table's fields. */
export interface FacetDescriptor {
  name:   string;
  /** The facet's tag in the row content message and its key derivation input. */
  tag:    number;
  fields: number[];
}

