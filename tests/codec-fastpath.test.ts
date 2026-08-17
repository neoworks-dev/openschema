// tests/codec-fastpath.test.ts
// The runtime prelude hand-rolls UTF-8 and the common ISO date/timestamp
// shapes instead of going through TextEncoder/TextDecoder and Date. These
// tests pin the fast paths against the natives they replace: same bytes,
// same strings, same millisecond values, on and around every threshold.

import { describe, it, expect, afterAll } from "bun:test";
import { cleanupCodecs, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const STRING_SCHEMA = `namespace t
model M {
  1 text: string
}`;

const TIME_SCHEMA = `namespace t
model T {
  1 day: date
  2 moment: timestamp
}`;

const textEncoder = new TextEncoder();

const TRICKY_STRINGS = [
  "",
  "a",
  "plain ascii",
  "a".repeat(31),
  "a".repeat(32),   // decode fast-path threshold
  "a".repeat(33),
  "a".repeat(63),
  "a".repeat(64),   // encode fast-path threshold
  "a".repeat(65),
  "héllo wörld",                 // 2-byte sequences
  "€ 12,50 – Straße",            // 3-byte sequences
  "😀😃😄",                      // astral pairs, 4-byte sequences
  "family: 👨‍👩‍👧",  // ZWJ sequence
  "mixed ascii é 😀 end",
  "✨".repeat(40),               // non-ascii past both thresholds
];

// TextEncoder replaces an unpaired surrogate with U+FFFD; the manual encoder
// must do exactly the same.
const LONE_SURROGATES = ["\ud800", "\udc00", "a\ud800b", "end\ud800", "\udc00start"];

describe("string fast paths", () => {
  it("encodes byte-for-byte what TextEncoder produces", async () => {
    const codec = await loadCodec(STRING_SCHEMA);
    for (const text of [...TRICKY_STRINGS, ...LONE_SURROGATES]) {
      const body = textEncoder.encode(text);
      const encoded = codec.encodeM({ text });
      // Field 1, wire type LEN, then the length varint TextEncoder implies.
      expect(encoded[0]).toBe(0x0a);
      const lengthWidth = body.length < 0x80 ? 1 : 2;
      expect([...encoded.slice(1 + lengthWidth)]).toEqual([...body]);
    }
  });

  it("decodes to the same string TextDecoder produces", async () => {
    const codec = await loadCodec(STRING_SCHEMA);
    for (const text of TRICKY_STRINGS) {
      expect(codec.decodeM(codec.encodeM({ text })).text).toBe(text);
    }
    for (const text of LONE_SURROGATES) {
      const decoded = codec.decodeM(codec.encodeM({ text })).text;
      expect(decoded).toBe(text.replace(/[\ud800-\udfff]/g, "�"));
    }
  });

  it("still rejects invalid UTF-8 on the fallback path", async () => {
    const codec = await loadCodec(STRING_SCHEMA);
    // Field 1 LEN, length 2, an overlong / truncated sequence.
    const bad = new Uint8Array([0x0a, 0x02, 0xc0, 0x20]);
    expect(() => codec.decodeM(bad)).toThrow("not valid UTF-8");
  });
});

describe("date fast paths", () => {
  const DATES = [
    "0000-01-01",
    "1969-12-31",
    "1970-01-01",
    "2000-02-29",   // century leap year
    "2024-02-29",
    "2026-07-28",
    "2100-02-28",   // century non-leap year
    "9999-12-31",
  ];

  it("matches Date.parse on every valid date", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    for (const day of DATES) {
      const expected = Math.floor(Date.parse(day + "T00:00:00.000Z") / 86400000);
      expect(codec.dateToDays(day, "t")).toBe(expected);
    }
  });

  it("round-trips through the manual formatter", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    for (const day of DATES) {
      expect(codec.daysToDate(codec.dateToDays(day, "t"), "t")).toBe(day);
    }
  });

  it("defers out-of-range components to Date.parse, as before", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    // JSC rolls some of these over ("2023-02-29" becomes March 1st) and
    // rejects others; the fast path must not change either outcome.
    for (const edge of ["2023-02-29", "2024-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00"]) {
      const expected = Date.parse(edge + "T00:00:00.000Z");
      if (Number.isNaN(expected)) {
        expect(() => codec.dateToDays(edge, "t")).toThrow("invalid date");
      } else {
        expect(codec.dateToDays(edge, "t")).toBe(Math.floor(expected / 86400000));
      }
    }
  });

  it("agrees with toISOString across the four-digit-year range", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    // A coarse sweep plus the window edges; -719528 is 0000-01-01.
    for (let days = -719528; days <= 2932896; days += 97003) {
      expect(codec.daysToDate(days, "t")).toBe(new Date(days * 86400000).toISOString().substring(0, 10));
    }
    expect(codec.daysToDate(-719528, "t")).toBe("0000-01-01");
    expect(codec.daysToDate(2932896, "t")).toBe("9999-12-31");
  });
});

describe("timestamp fast paths", () => {
  const MILLIS = [
    0,
    1,
    -1,
    999,
    -62167219200000,        // 0000-01-01T00:00:00.000Z
    253402300799999,        // 9999-12-31T23:59:59.999Z
    Date.parse("2000-02-29T23:59:59.999Z"),
    Date.parse("2026-07-28T10:00:00.000Z"),
    Date.parse("1912-06-23T01:02:03.045Z"),
  ];

  it("formats exactly like toISOString", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    for (const ms of MILLIS) {
      expect(codec.millisToTimestamp(ms, "t")).toBe(new Date(ms).toISOString());
    }
  });

  it("parses the toISOString shape exactly like Date.parse", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    for (const ms of MILLIS) {
      const iso = new Date(ms).toISOString();
      expect(codec.timestampToMillis(iso, "t")).toBe(ms);
    }
  });

  it("falls back to Date.parse for other accepted shapes", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    const shapes = [
      "2026-07-28T10:00:00Z",           // no milliseconds
      "2026-07-28T12:00:00.000+02:00",  // offset instead of Z
      "+010000-01-01T00:00:00.000Z",    // expanded year
    ];
    for (const value of shapes) {
      expect(codec.timestampToMillis(value, "t")).toBe(Date.parse(value));
    }
  });

  it("matches Date.parse on shapes the fast path rejects", async () => {
    const codec = await loadCodec(TIME_SCHEMA);
    for (const edge of ["not a time", "2026-07-28T25:00:00.000Z", "2026-02-30T10:00:00.000Z"]) {
      const expected = Date.parse(edge);
      if (Number.isNaN(expected)) {
        expect(() => codec.timestampToMillis(edge, "t")).toThrow("invalid timestamp");
      } else {
        expect(codec.timestampToMillis(edge, "t")).toBe(expected);
      }
    }
  });
});
