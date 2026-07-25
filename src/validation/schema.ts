/**
 * The corpus metadata schema: the allowed keys, their types, and which are
 * required, for each kind of metadata block. This is the single source of truth
 * the validator enforces; the prose tables in ../README.md describe the same
 * schema for humans.
 */

export type ValueType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "map"; // a [metadata.<key>] section whose values are all strings

/** The ways `metadata` violates `schema`: one message per unknown or mistyped
 * key, without any file/section locus (the caller knows where it is). */
export const keyViolations = (
  metadata: Record<string, unknown>,
  schema: Record<string, ValueType>,
): string[] => {
  const violations: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!(key in schema)) violations.push(`unknown key "${key}"`);
    else if (!typeMatches(value, schema[key])) {
      violations.push(`"${key}" should be ${schema[key]}`);
    }
  }
  return violations;
};

export const typeMatches = (value: unknown, type: ValueType): boolean =>
  type === "map"
    ? typeof value === "object" && value !== null && !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string")
    : type.endsWith("[]")
    ? Array.isArray(value) &&
      value.every((item) => isScalar(item, type.slice(0, -2)))
    : isScalar(value, type);

const isScalar = (value: unknown, type: string): boolean =>
  type === "string"
    ? typeof value === "string"
    : type === "number"
    ? typeof value === "number"
    : typeof value === "boolean";

/** The ways `metadata` breaks an identifier key's form: one message per key
 * whose value does not match its pattern. Typed-string keys only, so a key of
 * the wrong type is already reported by `keyViolations` and skipped here. */
export const identifierViolations = (
  metadata: Record<string, unknown>,
  formats: Record<string, IdentifierFormat>,
): string[] => {
  const violations: string[] = [];
  for (const [key, format] of Object.entries(formats)) {
    const value = metadata[key];
    if (typeof value !== "string" || format.pattern.test(value)) continue;
    violations.push(`"${key}" should be ${format.shape}`);
  }
  return violations;
};

/** An external identifier's expected form: the pattern its value must match,
 * and a human description of that pattern for the violation message. */
export type IdentifierFormat = { pattern: RegExp; shape: string };

/** Author metadata (root of `data/authors/<author>.mit`). */
export const authorSchema: Record<string, ValueType> = {
  title: "string",
  forename: "string",
  surname: "string",
  birth: "number",
  death: "number",
  nationality: "string",
  sex: "string",
  viaf: "string",
  wikidata: "string",
};

export const authorRequired = [
  "forename",
  "surname",
  "birth",
  "death",
  "nationality",
  "sex",
];

export const authorSexValues = ["Male", "Female"];

/** The external identifiers an author may carry (see ../../README.md#external-identifiers). */
export const authorIdentifiers: Record<string, IdentifierFormat> = {
  viaf: { pattern: /^[1-9]\d*$/, shape: "a VIAF cluster ID (digits)" },
  wikidata: {
    pattern: /^Q[1-9]\d*$/,
    shape: 'a Wikidata item ID ("Q" + digits)',
  },
};

/** Text metadata (work stubs and dated editions, and their sections). */
export const textSchema: Record<string, ValueType> = {
  title: "string",
  breadcrumb: "string",
  authors: "string[]",
  imported: "boolean",
  published: "number[]",
  canonical: "string",
  standalone: "boolean",
  sourceUrl: "string",
  sourceDesc: "string",
  estc: "string",
  tcp: "string",
  dictionary: "map",
};

/** The external identifiers an edition may carry (see ../../README.md#external-identifiers). */
export const textIdentifiers: Record<string, IdentifierFormat> = {
  estc: {
    pattern: /^[NPRSTW][1-9]\d*$/,
    shape: 'an ESTC citation number ("N", "P", "R", "S", "T" or "W" + digits)',
  },
  // TCP IDs are fixed-width: EEBO-TCP (A, B) and Evans-TCP (N) are the prefix
  // plus five zero-padded digits; ECCO-TCP (K) is six digits plus a part suffix.
  tcp: {
    pattern: /^(?:[ABN]\d{5}|K\d{6}\.\d{3})$/,
    shape: 'a TCP text ID ("A00002", "K000039.000")',
  },
};

/** Block-level metadata. */
export const blockSchema: Record<string, ValueType> = {
  pages: "string",
  speaker: "string",
  subsection: "string",
  authors: "string[]",
};
