/** A JSON-compatible scalar value. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Any value that is valid in a JSON document: a scalar, an array of
 * JSON values, or an object whose values are themselves JSON values.
 * Used throughout the report layer to ensure serialisability.
 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
