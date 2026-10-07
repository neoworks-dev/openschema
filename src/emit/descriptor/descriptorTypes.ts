// src/emit/descriptor/descriptorTypes.ts
// The `descriptor` target's output: a schema compiled for runtimes that encode,
// decode and validate without generated code. Field references are ordinals, not
// names, so a rename never changes what a reference points at.

import type { Container, ValueShape } from "../codec/plan.js";

export const DESCRIPTOR_VERSION = 1;

export interface SchemaDescriptor {
  descriptorVersion: number;
  namespace:         string;
  enums:             EnumDescriptor[];
  models:            ModelDescriptor[];
  nodes:             NodeDescriptor[];
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

export type NodeKind = "root" | "container" | "item";

/** A model stored as the content of a Neoworks node of one kind. */
export interface NodeDescriptor {
  kind:       NodeKind;
  model:      string;
  facets:     FacetDescriptor[];
  /** Ordinals of string fields the client indexes for search. */
  searchable: number[];
  timeRange:  TimeRangeDescriptor | null;
}

/** A separately encrypted group of a node model's fields. */
export interface FacetDescriptor {
  name:   string;
  /** The facet's tag in the node content message and its key derivation input. */
  tag:    number;
  fields: number[];
}

export interface TimeRangeDescriptor {
  start: number;
  end:   number;
}
