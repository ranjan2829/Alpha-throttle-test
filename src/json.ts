import { PlanValidationError } from "./errors.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function parseJsonObject(text: string, source: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PlanValidationError(`${source} is not valid JSON: ${message}`);
  }
  if (!isJsonObject(parsed)) {
    throw new PlanValidationError(`${source} must be a JSON object`);
  }
  return parsed;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(obj: JsonObject, key: string, label?: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PlanValidationError(`${label ?? key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new PlanValidationError(`${key} must be a string`);
  }
  return value;
}

export function optionalNullableString(obj: JsonObject, key: string): string | null | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new PlanValidationError(`${key} must be a string or null`);
  }
  return value;
}

export function requireInt(obj: JsonObject, key: string, min: number, fallback?: number): number {
  const value = obj[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new PlanValidationError(`${key} must be an integer >= ${min}`);
  }
  return value;
}

export function requireStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PlanValidationError(`${key} must be an array of non-empty strings`);
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new PlanValidationError(`${key} must be an array of non-empty strings`);
    }
    strings.push(item);
  }
  return strings;
}

export function requireObject(obj: JsonObject, key: string): JsonObject | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw new PlanValidationError(`${key} must be an object`);
  }
  return value;
}

export function requireArray(obj: JsonObject, key: string): JsonValue[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new PlanValidationError(`${key} must be an array`);
  }
  return value;
}
