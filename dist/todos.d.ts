export interface Todo {
    file: string;
    line: number;
    kind: string;
    text: string;
    date: string | null;
    expired: boolean;
}
export interface TodosResult {
    clean: boolean;
    todos: Todo[];
    expired: Todo[];
}
/** Source files to scan: src/ when present, else the cwd (excluding node_modules). Exported for tests. */
export declare function sourceFiles(cwd?: string): string[];
/** Parse a single line for a TODO comment. Returns null when no TODO found. Exported for tests. */
export declare function parseTodoLine(line: string): {
    kind: string;
    date: string | null;
} | null;
export declare function runTodos(cwd?: string, evaluatedAt?: string): TodosResult;
/** Human-readable report. Returns true when no TODO is past its date. */
export declare function reportTodos(cwd?: string): boolean;
