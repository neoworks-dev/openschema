// src/emit/kotlin/kotlinNames.ts
// Identifiers and package names for the Kotlin target.

const HARD_KEYWORDS: ReadonlySet<string> = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface",
  "is", "null", "object", "package", "return", "super", "this", "throw", "true", "try", "typealias",
  "typeof", "val", "var", "when", "while",
]);

/** Kotlin names the schema may not use as they are written in backticks. */
export function identifier(name: string): string {
  if (HARD_KEYWORDS.has(name)) return `\`${name}\``;
  return name;
}

export function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** `google-calendar` is `GoogleCalendar`. */
export function pascalCase(name: string): string {
  return name.split(/[^A-Za-z0-9]+/).filter(word => word.length > 0).map(capitalize).join("");
}

/** The name segment of `@scope/name` as a package segment: lower case letters and digits only. */
export function packageSegment(collectionName: string): string {
  const name = collectionName.slice(collectionName.indexOf("/") + 1);
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The directory of a package inside a source root. */
export function packageDirectory(packageName: string): string {
  return packageName.split(".").join("/");
}
