// Package collections is the stub of the SDK's collections package that the go-collection tests
// compile generated code against. It declares exactly the identifiers and signatures the
// generated code uses, and implements the JSON encodings of the value types for real, so the
// tests can check that the generated structs read and write the core's content JSON. The
// operators and runtime of the real package are not part of the stub.
package collections

import (
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"

	"github.com/neoworks-dev/sdk-go/vault"
)

type Condition struct{}
type Order struct{}
type Change struct{}

// Child returns a new path that is path followed by name; it never shares memory with path.
func Child(path []string, name string) []string {
	child := make([]string, 0, len(path)+1)
	child = append(child, path...)
	return append(child, name)
}

// Int64 is a 64-bit integer inside a list, map or oneof, where JSON holds it as decimal text.
type Int64 int64

func (value Int64) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatInt(int64(value), 10))
}

func (value *Int64) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	parsed, err := strconv.ParseInt(text, 10, 64)
	*value = Int64(parsed)
	return err
}

type Uint64 uint64

func (value Uint64) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatUint(uint64(value), 10))
}

func (value *Uint64) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	parsed, err := strconv.ParseUint(text, 10, 64)
	*value = Uint64(parsed)
	return err
}

// Duration is a duration in nanoseconds inside a list, map or oneof, held as decimal text.
type Duration time.Duration

func (value Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatInt(int64(value), 10))
}

func (value *Duration) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	parsed, err := strconv.ParseInt(text, 10, 64)
	*value = Duration(parsed)
	return err
}

// Uint8 is a byte-sized number inside a list: encoding/json would write a list of uint8 as base64 text.
type Uint8 uint8

func (value Uint8) MarshalJSON() ([]byte, error) {
	return strconv.AppendUint(nil, uint64(value), 10), nil
}

func (value *Uint8) UnmarshalJSON(data []byte) error {
	parsed, err := strconv.ParseUint(string(data), 10, 8)
	*value = Uint8(parsed)
	return err
}

// Bytes is binary data, held as unpadded base64url text.
type Bytes []byte

func (value Bytes) MarshalJSON() ([]byte, error) {
	return json.Marshal(base64.RawURLEncoding.EncodeToString(value))
}

func (value *Bytes) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(text)
	*value = decoded
	return err
}

// File is a File value as the core stores it.
type File struct {
	ObjectID  string                 `json:"objectId"`
	Name      string                 `json:"name"`
	MediaType string                 `json:"mediaType"`
	Size      Uint64                 `json:"size"`
	Variants  map[string]FileVariant `json:"variants"`
}

type FileVariant struct {
	ObjectID string `json:"objectId"`
	Size     Uint64 `json:"size"`
}

type Number interface {
	~int8 | ~int16 | ~int32 | ~int64 | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~float32 | ~float64
}

type StringField struct{ path []string }

func NewStringField(path ...string) StringField           { return StringField{path} }
func (field StringField) Equals(value string) Condition   { return Condition{} }
func (field StringField) Contains(value string) Condition { return Condition{} }
func (field StringField) Set(value string) Change         { return Change{} }
func (field StringField) Clear() Change                   { return Change{} }
func (field StringField) Asc() Order                      { return Order{} }

type NumberField[N Number] struct{ path []string }

func NewNumberField[N Number](path ...string) NumberField[N] { return NumberField[N]{path} }
func (field NumberField[N]) Gt(value N) Condition            { return Condition{} }
func (field NumberField[N]) Set(value N) Change              { return Change{} }
func (field NumberField[N]) Clear() Change                   { return Change{} }

type BoolField struct{ path []string }

func NewBoolField(path ...string) BoolField         { return BoolField{path} }
func (field BoolField) Equals(value bool) Condition { return Condition{} }
func (field BoolField) Set(value bool) Change       { return Change{} }
func (field BoolField) Clear() Change               { return Change{} }

type TimeField struct{ path []string }

func NewTimeField(path ...string) TimeField          { return TimeField{path} }
func (field TimeField) Lt(value time.Time) Condition { return Condition{} }
func (field TimeField) Desc() Order                  { return Order{} }
func (field TimeField) Set(value time.Time) Change   { return Change{} }
func (field TimeField) Clear() Change                { return Change{} }

type EnumField[E ~string] struct{ path []string }

func NewEnumField[E ~string](path ...string) EnumField[E] { return EnumField[E]{path} }
func (field EnumField[E]) Equals(value E) Condition       { return Condition{} }
func (field EnumField[E]) Set(value E) Change             { return Change{} }
func (field EnumField[E]) Clear() Change                  { return Change{} }

type RefField struct{ path []string }

func NewRefField(path ...string) RefField            { return RefField{path} }
func (field RefField) Equals(rowID string) Condition { return Condition{} }
func (field RefField) Set(rowID string) Change       { return Change{} }
func (field RefField) Clear() Change                 { return Change{} }

type BytesField struct{ path []string }

func NewBytesField(path ...string) BytesField    { return BytesField{path} }
func (field BytesField) Set(value []byte) Change { return Change{} }
func (field BytesField) Clear() Change           { return Change{} }

type FileField struct {
	Name      StringField
	MediaType StringField
	Size      NumberField[uint64]
}

func NewFileField(path ...string) FileField {
	return FileField{
		Name:      NewStringField(Child(path, "name")...),
		MediaType: NewStringField(Child(path, "mediaType")...),
		Size:      NewNumberField[uint64](Child(path, "size")...),
	}
}

func (field FileField) Set(value File) Change { return Change{} }
func (field FileField) Clear() Change         { return Change{} }

// ListField is a list or a map: V is the Go type of the whole field, H the handle of one element.
type ListField[V any, H any] struct {
	path    []string
	element func(path ...string) H
}

func NewListField[V any, H any](element func(path ...string) H, path ...string) ListField[V, H] {
	return ListField[V, H]{path, element}
}

func (field ListField[V, H]) Some(build func(element H) Condition) Condition {
	return build(field.element())
}
func (field ListField[V, H]) Set(value V) Change { return Change{} }
func (field ListField[V, H]) Clear() Change      { return Change{} }

// MessageField is the whole-message handle that the handles of an embedded message include.
type MessageField[M any] struct{ path []string }

func NewMessageField[M any](path ...string) MessageField[M] { return MessageField[M]{path} }
func (field MessageField[M]) Set(value M) Change            { return Change{} }
func (field MessageField[M]) Clear() Change                 { return Change{} }

// ValueField sets and clears a field that queries cannot filter on.
type ValueField[V any] struct{ path []string }

func NewValueField[V any](path ...string) ValueField[V] { return ValueField[V]{path} }
func (field ValueField[V]) Set(value V) Change          { return Change{} }
func (field ValueField[V]) Clear() Change               { return Change{} }

type TableDefinition struct {
	Model      string
	References map[string]string
}

type Table[T any] struct {
	collection *Collection
	definition TableDefinition
}

func NewTable[T any](collection *Collection, definition TableDefinition) *Table[T] {
	return &Table[T]{collection, definition}
}

type Schema struct {
	Name       string
	Version    string
	Descriptor []byte
	Scopes     []string
}

type Collection struct{ Schema Schema }

type Option func(*Collection)

func Open(v *vault.Vault, schema Schema, options ...Option) (*Collection, error) {
	return &Collection{schema}, nil
}
