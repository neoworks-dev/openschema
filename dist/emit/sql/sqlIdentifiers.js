// src/emit/sql/sqlIdentifiers.ts
// Quoting of table, column and type names for the SQL targets. Names are used
// exactly as written in the schema; quotes are added only where a bare name
// would be read differently, so every other name renders bare.
// The keywords of SQLite plus the reserved words of PostgreSQL. Either dialect
// may reject such a word as a bare name (`CREATE TABLE group (`).
const SQL_KEYWORDS = new Set([
    "abort", "action", "add", "after", "all", "alter", "always", "analyse", "analyze", "and", "any",
    "array", "as", "asc", "asymmetric", "attach", "authorization", "autoincrement", "before", "begin",
    "between", "binary", "both", "by", "cascade", "case", "cast", "check", "collate", "collation",
    "column", "commit", "concurrently", "conflict", "constraint", "create", "cross", "current",
    "current_catalog", "current_date", "current_role", "current_schema", "current_time",
    "current_timestamp", "current_user", "database", "default", "deferrable", "deferred", "delete",
    "desc", "detach", "distinct", "do", "drop", "each", "else", "end", "escape", "except", "exclude",
    "exclusive", "exists", "explain", "fail", "false", "fetch", "filter", "first", "following", "for",
    "foreign", "freeze", "from", "full", "generated", "glob", "grant", "group", "groups", "having", "if",
    "ignore", "ilike", "immediate", "in", "index", "indexed", "initially", "inner", "insert", "instead",
    "intersect", "into", "is", "isnull", "join", "key", "last", "lateral", "leading", "left", "like",
    "limit", "localtime", "localtimestamp", "match", "materialized", "natural", "no", "not", "nothing",
    "notnull", "null", "nulls", "of", "offset", "on", "only", "or", "order", "others", "outer", "over",
    "overlaps", "partition", "placing", "plan", "pragma", "preceding", "primary", "query", "raise",
    "range", "recursive", "references", "regexp", "reindex", "release", "rename", "replace", "restrict",
    "returning", "right", "rollback", "row", "rows", "savepoint", "select", "session_user", "set",
    "similar", "some", "symmetric", "system_user", "table", "tablesample", "temp", "temporary", "then",
    "ties", "to", "trailing", "transaction", "trigger", "true", "unbounded", "union", "unique", "update",
    "user", "using", "vacuum", "values", "variadic", "verbose", "view", "virtual", "when", "where",
    "window", "with", "without",
]);
// PostgreSQL folds a bare name to lower case, so any upper-case letter needs quotes.
const BARE_POSTGRES_NAME = /^[a-z_][a-z0-9_]*$/;
// SQLite matches names case-insensitively, so case alone never needs quotes.
const BARE_SQLITE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A table, column or type name for PostgreSQL: quoted when it is a keyword or not all lower case. */
export function quotePostgresIdentifier(name) {
    if (BARE_POSTGRES_NAME.test(name) && !SQL_KEYWORDS.has(name))
        return name;
    return doubleQuoted(name);
}
/** A table or column name for SQLite: quoted when it is a keyword or has characters a bare name can't. */
export function quoteSqliteIdentifier(name) {
    if (BARE_SQLITE_NAME.test(name) && !SQL_KEYWORDS.has(name.toLowerCase()))
        return name;
    return doubleQuoted(name);
}
function doubleQuoted(name) {
    return `"${name.replace(/"/g, '""')}"`;
}
//# sourceMappingURL=sqlIdentifiers.js.map