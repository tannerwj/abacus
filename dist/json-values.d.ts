export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function objectValue(value: unknown, message?: string): Record<string, unknown>;
export declare function jsonObject(source: string): Record<string, unknown>;
export declare function enumValue<const T extends readonly string[]>(value: unknown, choices: T): T[number];
export declare function arrayValue(value: unknown): unknown[];
export declare function stringValue(value: unknown): string;
export declare function numberValue(value: unknown): number;
