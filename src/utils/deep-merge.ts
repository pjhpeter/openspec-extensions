export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends JsonObject, U extends JsonObject>(base: T, override: U): T & U {
  const result: Record<string, JsonValue> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(current, overrideValue);
      continue;
    }
    result[key] = overrideValue;
  }
  return result as T & U;
}
