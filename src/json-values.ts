export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function objectValue(
  value: unknown,
  message = "Invalid report object",
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}
export function jsonObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  return objectValue(value);
}
export function enumValue<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] {
  const match = choices.find((choice) => choice === value);
  if (match === undefined) throw new Error("Unsupported selection");
  return match;
}
export function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid report array");
  return value;
}
export function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid report text");
  return value;
}
export function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid report number");
  return value;
}
