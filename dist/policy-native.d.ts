export declare function relativeFile(value: unknown, label: string): asserts value is string;
export declare function bundledFile(root: string, relative: string): string;
/** No config code executes here. Only declared bundled data files form the closure. */
export declare function validateNativeClosure(root: string, files: string[]): void;
