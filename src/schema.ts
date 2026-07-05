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
  | "number[]";

const isScalar = (value: unknown, type: string): boolean =>
  type === "string"
    ? typeof value === "string"
    : type === "number"
    ? typeof value === "number"
    : typeof value === "boolean";

export const typeMatches = (value: unknown, type: ValueType): boolean =>
  type.endsWith("[]")
    ? Array.isArray(value) &&
      value.every((item) => isScalar(item, type.slice(0, -2)))
    : isScalar(value, type);

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

/** Author metadata (root of `data/authors/<author>.mit`). */
export const authorSchema: Record<string, ValueType> = {
  title: "string",
  forename: "string",
  surname: "string",
  birth: "number",
  death: "number",
  nationality: "string",
  sex: "string",
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
};

/** Block-level metadata. */
export const blockSchema: Record<string, ValueType> = {
  pages: "string",
  speaker: "string",
  subsection: "string",
  authors: "string[]",
};
