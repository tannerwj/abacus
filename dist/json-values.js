export function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function objectValue(value, message = "Invalid report object") {
    if (!isRecord(value))
        throw new Error(message);
    return value;
}
export function jsonObject(source) {
    const value = JSON.parse(source);
    return objectValue(value);
}
export function enumValue(value, choices) {
    const match = choices.find((choice) => choice === value);
    if (match === undefined)
        throw new Error("Unsupported selection");
    return match;
}
export function arrayValue(value) {
    if (!Array.isArray(value))
        throw new Error("Invalid report array");
    return value;
}
export function stringValue(value) {
    if (typeof value !== "string")
        throw new Error("Invalid report text");
    return value;
}
export function numberValue(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error("Invalid report number");
    return value;
}
