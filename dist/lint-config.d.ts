/** Known Oxlint native semantics only: shared ignores must be rooted at the consumer. */
export declare function sharedLintIgnores(file: string, visited?: Set<string>): string[];
